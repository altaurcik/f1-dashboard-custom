// Local SSE bridge to the real Formula 1 SignalR feed. No simulated data.
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const WebSocket = require('next/dist/compiled/ws');
if (require('node:fs').existsSync('.env.local')) process.loadEnvFile('.env.local');
const base = 'https://livetiming.formula1.com/signalrcore';
const websocketUrl = process.env.F1_LIVE_WEBSOCKET_URL;
const sourceUrl = websocketUrl || base;
const separator = '\x1e';
const topics = ['Heartbeat', 'CarData.z', 'Position.z', 'ExtrapolatedClock', 'TimingStats', 'TimingAppData', 'WeatherData', 'TrackStatus', 'SessionStatus', 'DriverList', 'RaceControlMessages', 'SessionInfo', 'SessionData', 'LapCount', 'TimingData', 'TeamRadio', 'ChampionshipPrediction'];
const clients = new Set();
let state = {}, connected = false, lastUpdate = null, lastError = null;
let socket, reconnectTimer, stopping = false;
function normalize(value) {
  return Object.fromEntries(Object.entries(value).map(([key, data]) => [key === 'CarData.z' ? 'CarDataZ' : key === 'Position.z' ? 'PositionZ' : key, data]));
}
function merge(previous, update) {
  if (update && typeof update === 'object' && !Array.isArray(update)) {
    const result = previous && typeof previous === 'object' ? previous : {};
    for (const [key, value] of Object.entries(update)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      result[key] = merge(result[key], value);
    }
    return result;
  }
  return update;
}
function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const response of clients) response.write(frame);
}
function disconnectClients() {
  for (const response of clients) response.end();
  clients.clear();
}
function reconnect(error) {
  if (error) { lastError = error.message; console.error(new Date().toISOString(), lastError); }
  connected = false;
  disconnectClients();
  if (!stopping && !reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 5000);
}
async function connect() {
  try {
    let url = websocketUrl;
    const headers = { 'User-Agent': 'BestHTTP', 'Accept-Encoding': 'gzip,identity' };
    if (!url) {
      const options = await fetch(base + '/negotiate', { method: 'OPTIONS', signal: AbortSignal.timeout(15000) });
      const cookie = options.headers.getSetCookie().find(value => value.startsWith('AWSALBCORS='))?.split(';')[0];
      const response = await fetch(base + '/negotiate?negotiateVersion=1', {
        method: 'POST', headers: cookie ? { Cookie: cookie } : {}, signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('F1 negotiation returned HTTP ' + response.status);
      const negotiation = await response.json();
      if (!negotiation.connectionToken) throw new Error('F1 negotiation returned no connection token');
      url = base.replace('https:', 'wss:') + '?id=' + encodeURIComponent(negotiation.connectionToken);
      if (cookie) headers.Cookie = cookie;
    }
    const ws = new WebSocket(url, { headers, handshakeTimeout: 15000 });
    socket = ws;
    let handshake = false, pending = '', lastMessage = Date.now();
    const invocationId = randomUUID();
    const timeout = setTimeout(() => ws.terminate(), 30000);
    const ping = setInterval(() => {
      if (Date.now() - lastMessage > 45000) ws.terminate();
      else if (ws.readyState === WebSocket.OPEN) { ws.ping(); ws.send(JSON.stringify({ type: 6 }) + separator); }
    }, 15000);
    ws.on('pong', () => { lastMessage = Date.now(); });
    ws.on('open', () => ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + separator));
    ws.on('message', (data) => {
      lastMessage = Date.now();
      pending += data.toString();
      let index;
      while ((index = pending.indexOf(separator)) >= 0) {
        const frame = pending.slice(0, index);
        pending = pending.slice(index + 1);
        if (!frame) continue;
        try {
          const message = JSON.parse(frame);
          if (!handshake) {
            if (message.error) throw new Error(message.error);
            handshake = true;
            ws.send(JSON.stringify({ type: 1, invocationId, target: 'Subscribe', arguments: [topics] }) + separator);
          } else if (message.type === 3 && message.invocationId === invocationId) {
            if (message.error) throw new Error(message.error);
            if (!message.result || typeof message.result !== 'object') throw new Error('F1 subscription returned no state');
            state = normalize(message.result);
            connected = true; lastError = null; lastUpdate = new Date().toISOString();
            clearTimeout(timeout);
            broadcast('initial', state);
            console.log(lastUpdate, 'Subscribed to real F1 feed:', state.SessionInfo?.Meeting?.Name, state.SessionInfo?.Name, 'drivers:', Object.keys(state.DriverList || {}).length);
          } else if (message.type === 1 && message.target?.toLowerCase() === 'feed') {
            const [topic, value] = message.arguments;
            if (topic === 'SessionInfo' && ((value?.Key && state.SessionInfo?.Key && value.Key !== state.SessionInfo.Key) || (value?.Name && state.SessionInfo?.Name && value.Name !== state.SessionInfo.Name))) { ws.close(); return; }
            const update = normalize({ [topic]: value });
            state = merge(state, update); lastUpdate = new Date().toISOString();
            if (connected) broadcast('update', update);
          } else if (message.type === 7) {
            if (message.error) lastError = message.error;
            ws.close();
          }
        } catch (error) { lastError = error.message; console.error(error.message); ws.terminate(); return; }
      }
    });
    ws.on('error', error => { lastError = error.message; console.error(error.message); });
    ws.on('close', () => { clearTimeout(timeout); clearInterval(ping); reconnect(new Error(lastError || 'F1 connection closed; reconnecting')); });
  } catch (error) { reconnect(error); }
}
const server = http.createServer((request, response) => {
  const origin = request.headers.origin;
  if (['http://localhost:3000', 'http://127.0.0.1:3000'].includes(origin)) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
  response.setHeader('Cache-Control', 'no-store');
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/api/realtime' && connected) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
    response.write(`event: initial\ndata: ${JSON.stringify(state)}\n\n`);
    clients.add(response);
    const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 15000);
    response.on('close', () => { clients.delete(response); clearInterval(keepAlive); });
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  if (path === '/api/health') response.end(JSON.stringify({ source: sourceUrl, connected, lastUpdate, lastError }));
  else if (path === '/api/current' && connected) response.end(JSON.stringify(state));
  else if (path === '/api/drivers' && connected) response.end(JSON.stringify(Object.values(state.DriverList || {}).filter(value => value && typeof value === 'object')));
  else if (['/api/realtime', '/api/current', '/api/drivers'].includes(path)) { response.writeHead(503); response.end(JSON.stringify({ error: lastError || 'Connecting to real Formula 1 feed' })); }
  else { response.writeHead(404); response.end(JSON.stringify({ error: 'Not found' })); }
});
server.listen(4000, '127.0.0.1', () => { console.log('Real F1 data bridge listening on http://127.0.0.1:4000'); connect(); });
server.on('error', error => { console.error(error.message); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  stopping = true; clearTimeout(reconnectTimer); socket?.terminate(); disconnectClients(); server.close(() => process.exit(0));
});
