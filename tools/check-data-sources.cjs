// Read-only checks of independent sources. Historical samples never enter the live store.
const fs = require("node:fs");
const { inflateRawSync } = require("node:zlib");
const archive = "https://livetiming.formula1.com/static/2023/2023-09-17_Singapore_Grand_Prix/2023-09-15_Practice_1/";
const topics = [
	"DriverList",
	"ExtrapolatedClock",
	"TimingData",
	"TimingStats",
	"TimingAppData",
	"WeatherData",
	"TrackStatus",
	"SessionStatus",
	"RaceControlMessages",
	"TeamRadio",
	"Position.z",
	"CarData.z",
];
async function read(url, stream = false, method = "GET") {
	const response = await fetch(url, {
		method,
		headers: { "User-Agent": "F1DashboardCustom/4.0.6", ...(stream ? { Range: "bytes=0-16383" } : {}) },
		signal: AbortSignal.timeout(15000),
	});
	let data;
	if (method !== "HEAD") {
		if (stream) {
			const reader = response.body.getReader();
			let raw = "";
			try {
				while (raw.length < 16384) {
					const part = await reader.read();
					if (part.done) break;
					raw += Buffer.from(part.value).toString("utf8");
					if (raw.includes("\n")) break;
				}
			} finally {
				await reader.cancel();
			}
			try {
				data = JSON.parse(
					raw
						.replace(/^\uFEFF/, "")
						.split("\n")[0]
						.trim()
						.slice(12),
				);
				if (typeof data === "string") data = JSON.parse(inflateRawSync(Buffer.from(data, "base64")).toString());
			} catch {
				data = null;
			}
		} else {
			try {
				data = JSON.parse((await response.text()).replace(/^\uFEFF/, ""));
			} catch {
				data = null;
			}
		}
	}
	return { status: response.status, contentType: response.headers.get("content-type"), data };
}
async function main() {
	const results = [];
	async function check(name, url, stream = false, method = "GET") {
		try {
			const { data, ...response } = await read(url, stream, method);
			const sample =
				name === "DriverList"
					? Object.values(data || {})[0]
					: name === "TimingData" || name === "TimingStats" || name === "TimingAppData"
						? Object.values(data?.Lines || {})[0]
						: name === "Position.z"
							? data?.Position?.[0]
							: name === "CarData.z"
								? data?.Entries?.[0]
								: data;
			const record = {
				name,
				url,
				...response,
				parsed: data !== null && data !== undefined,
				keys: Object.keys(sample || {}),
			};
			if (data?.detail) record.detail = data.detail;
			if (name === "Position.z") record.entryKeys = Object.keys(Object.values(sample?.Entries || {})[0] || {});
			if (name === "CarData.z") record.channels = Object.keys(Object.values(sample?.Cars || {})[0]?.Channels || {});
			if (name === "Jolpica") record.races = data?.MRData?.RaceTable?.Races?.length;
			results.push(record);
			console.log(
				`${name}: HTTP ${record.status}${record.parsed ? ", parsed" : ""}${record.detail ? ", " + record.detail : ""}`,
			);
		} catch (error) {
			results.push({ name, url, error: error.message });
			console.log(`${name}: ${error.message}`);
		}
	}
	for (const topic of topics) await check(topic, archive + topic + ".jsonStream", true);
	await check("SessionInfo", archive + "SessionInfo.json");
	await check(
		"LapCount (race)",
		"https://livetiming.formula1.com/static/2023/2023-09-17_Singapore_Grand_Prix/2023-09-17_Race/LapCount.jsonStream",
		true,
	);
	await check("Calendar 2026", "https://livetiming.formula1.com/static/2026/Index.json");
	await check("TeamRadio MP3", archive + "TeamRadio/SERPER01_11_20230915_104008.mp3", false, "HEAD");
	await check("OpenF1 archived driver", "https://api.openf1.org/v1/drivers?session_key=9158&driver_number=1");
	await check("Jolpica", "https://api.jolpi.ca/ergast/f1/2025/circuits/marina_bay/fastest/1/results/?limit=100");
	await check("GeoJSON", "https://raw.githubusercontent.com/bacinger/f1-circuits/master/circuits/sg-2008.geojson");
	const output = process.argv[2];
	if (output)
		fs.writeFileSync(
			output,
			JSON.stringify(
				{
					checkedAt: new Date().toISOString(),
					mode: "historical and metadata verification; authenticated live not tested",
					results,
				},
				null,
				2,
			) + "\n",
		);
	if (results.some((item) => item.error)) process.exitCode = 1;
}
main().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
