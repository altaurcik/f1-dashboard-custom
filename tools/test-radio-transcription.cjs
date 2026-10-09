const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const ts = require("typescript");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "f1-radio-test-"));
let recognitionRuns = 0,
	active = 0,
	maxActive = 0;
const api = {};
function spawn(_python, args) {
	const child = new EventEmitter();
	child.stderr = new PassThrough();
	child.kill = () => child.emit("close", 1);
	setImmediate(() => {
		if (args[0] === "-c") {
			child.emit("close", 0);
			return;
		}
		recognitionRuns++;
		active++;
		maxActive = Math.max(maxActive, active);
		setTimeout(() => {
			active--;
			if (args[1].includes("fail.mp3")) {
				child.stderr.write("Recognition failed\n");
				child.emit("close", 1);
				return;
			}
			const output = args[args.indexOf("--output") + 1];
			fs.writeFileSync(output, "[00:00 -> 00:02] Box now.\n\nPlain Text:\nBox now.\n");
			child.emit("close", 0);
		}, 15);
	});
	return child;
}
vm.runInNewContext(
	ts.transpileModule(fs.readFileSync("src/lib/server/radioTranscription.ts", "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
	}).outputText,
	{
		exports: api,
		require: (name) => (name === "node:child_process" ? { spawn } : require(name)),
		process: { cwd: () => process.cwd(), platform: process.platform, env: {} },
		setTimeout,
		clearTimeout,
		URL,
		Promise,
		Map,
	},
);
(async () => {
	try {
		const url = "https://livetiming.formula1.com/static/2026/TeamRadio/test.mp3";
		assert.equal(api.validateAudioUrl(url), url);
		for (const invalid of [
			undefined,
			"file:///tmp/a.mp3",
			"http://livetiming.formula1.com/static/a.mp3",
			"https://elsewhere.example/static/a.mp3",
			"https://livetiming.formula1.com/a.mp3",
			"https://user:pass@livetiming.formula1.com/static/a.mp3",
		])
			assert.throws(() => api.validateAudioUrl(invalid));
		assert.equal(api.extractPlainText("Plain Text:\r\nNo prefix."), "No prefix.");
		assert.equal(api.extractPlainText("[00:00] One.\r\n\r\nPlain Text:\r\nOne.\r\nTwo."), "One.\nTwo.");
		assert.equal(api.extractPlainText("[00:00 -> 00:01] One.\n[00:01 -> 00:02] Two."), "One. Two.");
		const config = { ...api.radioConfig(), cache: temp, python: "test-python" };
		assert.equal((await api.transcriptionStatus(config)).available, true, "Plain Whisper must work without HF_TOKEN");
		assert.equal(
			(await api.transcriptionStatus({ ...config, diarize: true })).available,
			true,
			"Public speaker separation must work without token",
		);
		const first = api.transcribeRadio(url, config);
		assert.equal(first, api.transcribeRadio(url, config), "Concurrent same audio must share the job");
		const second = api.transcribeRadio(url.replace("test.mp3", "other.mp3"), config);
		assert.deepEqual(await Promise.all([first, second]), ["Box now.", "Box now."]);
		assert.equal(recognitionRuns, 2);
		assert.equal(maxActive, 1, "Model processes must run sequentially");
		assert.equal(await api.transcribeRadio(url, { ...config, python: "missing-python" }), "Box now.");
		assert.equal(recognitionRuns, 2, "Cache is readable without runtime");
		await api.transcribeRadio(url, { ...config, model: "small.en" });
		assert.equal(recognitionRuns, 3, "Model changes invalidate cache");
		const failed = api.transcribeRadio(url.replace("test.mp3", "fail.mp3"), config);
		const after = api.transcribeRadio(url.replace("test.mp3", "after.mp3"), config);
		await assert.rejects(failed, /Recognition failed/);
		assert.equal(await after, "Box now.", "Failed job must not poison queue");
		await assert.rejects(api.transcribeRadio(url.replace("test.mp3", "fail.mp3"), config), /Recognition failed/);
		assert.equal(recognitionRuns, 6, "Failure is not retained as a successful cache");
		console.log(
			"Radio transcription: URL validation, plain no-token runtime, optional diarization, duplicate coalescing, sequential jobs, config-sensitive cache and failure recovery passed.",
		);
	} finally {
		for (const entry of fs.readdirSync(temp)) fs.unlinkSync(path.join(temp, entry));
		fs.rmdirSync(temp);
	}
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
