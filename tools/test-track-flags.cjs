const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
const assert = require("node:assert/strict");
function load(filename) {
	const exports = {};
	vm.runInNewContext(
		ts.transpileModule(fs.readFileSync(filename, "utf8"), {
			compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
		}).outputText,
		{ exports, require, console },
	);
	return exports;
}
const { resolveTrackFlags, getTrackFlagTone } = load("src/lib/trackFlags.ts");
const { createCircuitFlagSectors } = load("src/lib/circuitFlagSectors.ts");
const msg = (second, Flag, Scope, Sector) => ({
	Utc: "2026-10-09T12:00:" + String(second).padStart(2, "0") + "Z",
	Flag,
	Scope,
	Sector,
	Category: "Flag",
	Message: Flag,
	Lap: 0,
});
let input = Object.freeze([msg(2, "YELLOW", "Sector", 3), msg(3, "DOUBLE YELLOW", "Sector", 4)]);
let flags = resolveTrackFlags(input);
assert.equal(flags.wholeTrack, false);
assert.deepEqual(Array.from(flags.sectors), [3, 4]);
assert.equal(getTrackFlagTone(flags, "2"), "clear");
assert.equal(getTrackFlagTone(flags, "2", 3), "yellow");
assert.equal(getTrackFlagTone(flags, "2", 2), "clear");
assert.equal(getTrackFlagTone(flags, "1", 3), "clear");
flags = resolveTrackFlags([msg(4, "CLEAR", "Sector", 3), ...input]);
assert.deepEqual(Array.from(flags.sectors), [4]);
flags = resolveTrackFlags([msg(5, "YELLOW", "Track"), msg(6, "CLEAR", "Sector", 4), ...input]);
assert.equal(flags.wholeTrack, true);
assert.equal(getTrackFlagTone(flags, "2", 9), "yellow");
flags = resolveTrackFlags([msg(9, "CLEAR", "Track"), msg(5, "YELLOW", "Track"), ...input]);
assert.equal(flags.wholeTrack, false);
assert.equal(flags.sectors.size, 0);
flags = resolveTrackFlags([msg(10, "YELLOW", "Sector", 7), msg(9, "CLEAR", "Track"), msg(5, "YELLOW", "Track")]);
assert.deepEqual(Array.from(flags.sectors), [7]);
assert.equal(flags.wholeTrack, false);
flags = resolveTrackFlags([msg(1, "YELLOW", "Sector", 3), msg(2, "GREEN", "Track")]);
assert.deepEqual(Array.from(flags.sectors), [3]);
assert.equal(resolveTrackFlags([msg(1, "YELLOW", "Driver", 3)]).sectors.size, 0);
assert.equal(getTrackFlagTone(flags, "5", 3), "red");
assert.equal(getTrackFlagTone(flags, "4", 3), "safety");
assert.equal(getTrackFlagTone(resolveTrackFlags([]), "2"), "clear");
console.log(
	"Flags: local/double yellow, per-sector clear, global yellow/clear, unordered immutable messages, global GREEN preserves local warnings, red/SC precedence.",
);
const line = [
	[0, 0],
	[2, 0],
	[2, 2],
	[0, 2],
	[0, 0],
];
const zones = [
	{ number: 1, entry: [0.5, 0], exit: [2, 1] },
	{ number: 2, entry: [2, 1], exit: [0, 1] },
	{ number: 3, entry: [0, 1], exit: [0.5, 0] },
];
const result = createCircuitFlagSectors(line, zones);
assert.equal(result.features.length, 3);
assert.deepEqual(JSON.parse(JSON.stringify(result.features[0].geometry.coordinates)), [
	[0.5, 0],
	[2, 0],
	[2, 1],
]);
assert.deepEqual(JSON.parse(JSON.stringify(result.features[2].geometry.coordinates)), [
	[0, 1],
	[0, 0],
	[0.5, 0],
]);
assert.equal(createCircuitFlagSectors(line, [{ number: 0, entry: [0, 0], exit: [2, 0] }]).features.length, 0);
const length = (points) =>
	points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);
assert.ok(Math.abs(result.features.reduce((sum, f) => sum + length(f.geometry.coordinates), 0) - length(line)) < 1e-8);
const singapore = JSON.parse(fs.readFileSync("public/circuits/sg-2008.geojson", "utf8"));
const circuit = singapore.features.find((f) => f.geometry.type === "LineString" && !f.properties.role).geometry
	.coordinates;
const sectors = createCircuitFlagSectors(circuit, singapore.flagZones);
assert.equal(sectors.features.length, 16);
assert.ok(
	Math.abs(sectors.features.reduce((sum, f) => sum + length(f.geometry.coordinates), 0) - length(circuit)) < 1e-8,
);
const sector4 = sectors.features.find((f) => f.properties.sector === 4);
assert.ok(length(sector4.geometry.coordinates) < length(circuit) * 0.2);
console.log(
	"Geometry: projected boundaries, closure crossing, valid sector IDs, exact circuit coverage; Singapore sector 4 is a local part of the track.",
);
