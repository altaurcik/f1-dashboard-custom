const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
const api = {};
vm.runInNewContext(
	ts.transpileModule(fs.readFileSync("src/lib/timingConsistency.ts", "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText,
	{ exports: api },
);
const records = [
	{ Message: "CAR 10 (GAS) TIME 1:33.319 DELETED - TRACK LIMITS AT TURN 2 LAP 15 21:35:13" },
	{ Message: "CAR 6 (HAD) TIME 1:32.048 DELETED - TRACK LIMITS AT TURN 19 LAP 15 21:36:26" },
];
const gas = { RacingNumber: "10", NumberOfLaps: 15, LastLapTime: { Value: "1:33.319" }, BestLapTime: { Value: "" } };
assert.equal(api.isLastLapDeleted(gas, records), true);
assert.equal(api.canShowQualifyingGap(gas), false);
assert.equal(api.isLastLapDeleted({ ...gas, RacingNumber: "6", LastLapTime: { Value: "1:32.048" } }, records), true);
assert.equal(api.isLastLapDeleted({ ...gas, NumberOfLaps: 16 }, records), false);
assert.equal(
	api.isLastLapDeleted({ ...gas, NumberOfLaps: 16, LastLapTime: { Value: "1:33.319", Lap: 15 } }, records),
	true,
);
assert.equal(api.isLastLapDeleted({ ...gas, RacingNumber: "44" }, records), false);
assert.equal(api.isLastLapDeleted({ ...gas, LastLapTime: { Value: "1:33.320" } }, records), false);
assert.equal(api.isLastLapDeleted({ ...gas, LastLapTime: { Value: "" } }, records), false);
assert.equal(api.isLastLapDeleted(gas, []), false);
assert.equal(api.canShowQualifyingGap({ ...gas, BestLapTime: { Value: "1:33.000" } }), true);
assert.equal(gas.NumberOfLaps, 15);
for (const part of [1, 2])
	assert.equal(api.isIntermediateQualifyingFinish("Qualifying", "Sprint Qualifying", "Finished", part), true);
assert.equal(api.isIntermediateQualifyingFinish("Qualifying", "Sprint Qualifying", "Finished", 3), false);
assert.equal(api.isIntermediateQualifyingFinish("Qualifying", "Qualifying", "Finalised", 1), false);
assert.equal(api.isIntermediateQualifyingFinish("Practice", "Practice 1", "Finished", 1), false);
assert.equal(api.isIntermediateQualifyingFinish("Qualifying", "Qualifying", "Started", 2), false);
console.log(
	"Timing consistency: exact deleted-lap identity, absent current best, physical lap count preservation, intermediate qualifying completion and finalization verified.",
);
