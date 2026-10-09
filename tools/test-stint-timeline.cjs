const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const api = {};
vm.runInNewContext(
	ts.transpileModule(fs.readFileSync("src/lib/stintTimeline.ts", "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText,
	{ exports: api },
);
assert.equal(api.getStintLapScale("Race", "Race", 62, [6, 8]), 62);
assert.equal(api.getStintLapScale("Race", "Sprint", 19, [6, 8]), 19);
assert.equal(api.getStintLapScale("Qualifying", "Sprint Qualifying", 62, [6, 8]), 8);
assert.equal(api.getStintLapScale("Practice", "Practice 1", 62, [8, 12, 9]), 12);
assert.equal(api.getStintLapScale("Race", "Race", undefined, [8, 12]), null);
assert.equal(api.getStintLapScale("Practice", "Practice 1", undefined, []), 0);
const input = Object.freeze([
	Object.freeze({ Compound: "MEDIUM", TotalLaps: 5, StartLaps: 2, New: "FALSE" }),
	Object.freeze({ Compound: "SOFT", TotalLaps: 4, StartLaps: 0, New: "true" }),
]);
const runs = api.buildTyreRuns(input);
assert.equal(runs[0].distance, 3);
assert.equal(runs[0].used, true);
assert.equal(runs[1].start, 3);
assert.equal(runs[1].end, 7);
assert.equal(runs[1].age, 4);
assert.equal(runs[1].used, false);
assert.equal(runs[1].distance / 62, 4 / 62);
assert.equal(runs[1].end / 12, 7 / 12);
const same = api.buildTyreRuns([
	{ Compound: "MEDIUM", TotalLaps: 2, StartLaps: 0, New: "true" },
	{ Compound: "MEDIUM", TotalLaps: 6, StartLaps: 3, New: "false", TyresNotChanged: "1" },
]);
assert.equal(same.length, 1);
assert.equal(same[0].distance, 6);
assert.equal(same[0].used, false);
assert.equal(
	api.buildTyreRuns([
		{ Compound: "MEDIUM", TotalLaps: 2, StartLaps: 0, New: "true" },
		{ Compound: "HARD", TotalLaps: 6, StartLaps: 3, New: "false", TyresNotChanged: "1" },
	]).length,
	2,
);
assert.equal(api.buildTyreRuns([{ Compound: "SOFT", New: "true" }]).length, 0);
assert.equal(api.buildTyreRuns([{ Compound: "SOFT", TotalLaps: 1 }])[0].condition, "unknown");
assert.equal(api.getLapAxis(62).at(-1), 62);
assert.equal(api.getLapAxis(62).includes(60), false);
assert.equal(api.getLapAxis(null).length, 1);
console.log(
	"Tyre timeline: fixed race/sprint scale; shared non-race maximum; used tyre age vs session distance; unchanged tyres; missing data and uncluttered axis verified.",
);
