const fs = require("node:fs"),
	ts = require("typescript"),
	vm = require("node:vm"),
	assert = require("node:assert/strict");
const api = {};
vm.runInNewContext(
	ts.transpileModule(fs.readFileSync("src/lib/driverComparison.ts", "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
	}).outputText,
	{ exports: api },
);
const mergeApi = {};
vm.runInNewContext(
	ts.transpileModule(fs.readFileSync("src/lib/merge.ts", "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS },
	}).outputText,
	{ exports: mergeApi },
);
let state, history, at;
function reset() {
	state = {
		SessionInfo: { Path: "test-race", Type: "Race", Name: "Race" },
		SessionStatus: { Status: "Started" },
		TrackStatus: { Status: "1" },
		TimingData: {
			SessionPart: 0,
			Lines: {
				1: { RacingNumber: "1", Position: "1", GapToLeader: "", NumberOfLaps: 10, LastLapTime: { Value: "1:31.000" } },
				2: {
					RacingNumber: "2",
					Position: "2",
					GapToLeader: "+5.000",
					IntervalToPositionAhead: { Value: "+5.000" },
					NumberOfLaps: 10,
					LastLapTime: { Value: "1:30.000" },
				},
			},
		},
		TimingAppData: { Lines: { 1: { Stints: [{ Compound: "MEDIUM" }] }, 2: { Stints: [{ Compound: "MEDIUM" }] } } },
	};
	at = 0;
	history = api.advanceComparison(api.emptyComparisonHistory(), state, state, at, true);
}
function feed(patch, ms = 1000) {
	at += ms;
	state = mergeApi.merge(state, patch);
	history = api.advanceComparison(history, state, patch, at);
}
function gap(value, ms = 15000) {
	feed(
		{
			TimingData: {
				Lines: {
					2: { GapToLeader: "+" + value.toFixed(3), IntervalToPositionAhead: { Value: "+" + value.toFixed(3) } },
				},
			},
		},
		ms,
	);
}
reset();
assert.equal(api.timeSeconds("1:30.123"), 90.123);
assert.equal(api.timeSeconds("—"), null);
assert.equal(api.timeSeconds(""), null);
assert.equal(api.raceGap(state, "1", "2").seconds, 5);
assert.equal(Object.keys(history.laps).length, 0, "Initial LAST is not historical lap evidence");
feed({ TimingData: { Lines: { 1: { NumberOfLaps: 11 } } } }, 90000);
assert.equal((history.laps["1"] || []).length, 0, "Lap count does not reuse stale LAST");
feed({ TimingData: { Lines: { 1: { LastLapTime: { Value: "1:31.000" } } } } });
assert.equal(history.laps["1"][0].excluded, "Partial lap");
feed({ TimingData: { Lines: { 1: { NumberOfLaps: 12 } } } }, 90000);
feed({ TimingData: { Lines: { 1: { LastLapTime: { Value: "1:31.000", Lap: 12 } } } } });
assert.equal(api.recentLaps(history, "1", state, 5).clean.length, 1, "Identical consecutive lap times are retained");
feed({ TrackStatus: { Status: "2" } });
feed({ TrackStatus: { Status: "1" } });
feed({ TimingData: { Lines: { 1: { NumberOfLaps: 13, LastLapTime: { Value: "1:30.900" } } } } }, 88000);
assert.equal(history.laps["1"].at(-1).excluded, "Yellow / SC / VSC / red");
feed({ RaceControlMessages: { Messages: [{ Message: "CAR 1 TIME 1:31.000 DELETED - LAP 12" }] } });
assert.equal(api.recentLaps(history, "1", state, 5).clean.length, 0, "Late deletion removes the lap from mean pace");
reset();
gap(5);
gap(4.8);
gap(4.6);
let result = api.compareDrivers(state, history, "1", "2", 5, at, false, true);
assert.equal(result.verdict, "catching");
assert.ok(Math.abs(result.closingPerMinute - 0.8) < 0.001);
assert.equal(result.estimate, null, "No forecast without clean laps");
assert.equal(
	api.compareDrivers(state, history, "2", "1", 5, at, false, true).verdict,
	"catching",
	"Selection order does not invert front/chaser",
);
assert.equal(api.compareDrivers(state, history, "1", "2", 5, at, true, true).verdict, "blocked");
assert.equal(api.compareDrivers(state, history, "1", "2", 5, at, false, false).verdict, "blocked");
assert.equal(
	api.compareDrivers(state, history, "1", "2", 5, at + 50000, false, true).verdict,
	"waiting",
	"Stale gap cannot claim live catching",
);
feed({ TimingData: { Lines: { 2: { InPit: true } } } });
assert.equal(api.compareDrivers(state, history, "1", "2", 5, at, false, true).verdict, "blocked");
feed({ TimingData: { Lines: { 2: { InPit: false } } } });
assert.equal(
	api.compareDrivers(state, history, "1", "2", 5, at, false, true).verdict,
	"waiting",
	"Trend resets after pit visit",
);
reset();
gap(5);
gap(5.2);
gap(5.4);
assert.equal(api.compareDrivers(state, history, "1", "2", 5, at, false, true).verdict, "falling");
reset();
gap(5);
gap(5);
gap(5);
assert.equal(api.compareDrivers(state, history, "1", "2", 5, at, false, true).verdict, "steady");
feed({ TimingData: { Lines: { 2: { GapToLeader: "+1 LAP", IntervalToPositionAhead: { Value: "+1 LAP" } } } } });
assert.equal(api.raceGap(state, "1", "2").seconds, null);
feed({
	SessionInfo: { Type: "Qualifying", Name: "Qualifying" },
	TimingData: { Lines: { 1: { BestLapTime: { Value: "1:30.000" } }, 2: { BestLapTime: { Value: "1:30.200" } } } },
});
result = api.compareDrivers(state, history, "1", "2", 5, at, false, true);
assert.equal(result.race, false);
assert.equal(result.verdict, "pace");
assert.ok(Math.abs(result.bestDelta + 0.2) < 0.001);
assert.equal(result.gap.seconds, null, "Qualifying best delta is not on-track distance");
feed({ TimingData: { SessionPart: 2 } });
assert.equal(Object.keys(history.gaps).length, 0, "Session part changes clear trend/history");
feed({ SessionInfo: { Path: "another-session" } });
assert.equal(Object.keys(history.laps).length, 0, "New session clears lap history");
reset();
gap(5);
gap(4.8);
gap(4.6);
history = api.advanceComparison(history, state, state, at, true);
assert.equal(
	api.compareDrivers(state, history, "1", "2", 5, at, false, true).verdict,
	"waiting",
	"Reconnect cannot reuse the old gap trend",
);
reset();
state.TimingData.Lines["2"].Position = "4";
history = api.advanceComparison(api.emptyComparisonHistory(), state, state, at, true);
gap(5);
gap(4.8);
gap(4.6);
assert.equal(
	api.compareDrivers(state, history, "1", "2", 5, at, false, true).verdict,
	"catching",
	"Leader to non-adjacent car uses the known leader zero gap",
);
reset();
feed(
	{
		TimingData: {
			Lines: {
				1: { NumberOfLaps: 11, LastLapTime: { Value: "1:30.500" }, BestLapTime: { Value: "1:30.500", Lap: 10 } },
			},
		},
	},
	90000,
);
assert.equal(history.laps["1"][0].lap, 10, "Native best-lap metadata resolves the counter offset");
reset();
feed({ TimingData: { Lines: { 1: { NumberOfLaps: 11, LastLapTime: { Value: "1:30.500" } } } } }, 90000);
assert.equal(history.laps["1"][0].lap, null, "Unconfirmed lap numbers are not guessed");
console.log(
	"Driver comparison: stale LAST, split lap packets, identical laps, partial/caution/deleted exclusions, gap direction, stale/paused/disconnected states, pit reset, lapped cars and qualifying passed.",
);
