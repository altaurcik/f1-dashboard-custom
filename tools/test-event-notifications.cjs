const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const historic = { Utc: "2026-10-09T12:00:00", Category: "Other", Message: "SQ1 WILL RESUME AT 20:46" };
const incident = {
	Utc: "2026-10-09T12:01:00",
	Category: "Other",
	Message: "TURN 5 INCIDENT INVOLVING CAR 11 (PER) NOTED - UNSAFE CONDITION",
};
let data = { state: { SessionInfo: { Path: "session-a" }, RaceControlMessages: { Messages: [historic] } } };
let notify, cleanup;
let toasts = [];
const preferences = { notifications: true, desktopNotifications: false };
const timers = new Map();
let timerId = 0;
const componentExports = {};
const source = ts.transpileModule(fs.readFileSync("src/components/live/EventPanels.tsx", "utf8"), {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
vm.runInNewContext(source, {
	exports: componentExports,
	console,
	Audio: class {
		play() {
			return Promise.resolve();
		}
		pause() {}
	},
	setTimeout(callback) {
		const id = ++timerId;
		timers.set(id, callback);
		return id;
	},
	clearTimeout(id) {
		timers.delete(id);
	},
	require(name) {
		if (name === "react")
			return {
				useEffect(callback) {
					cleanup = callback();
				},
				useState(value) {
					toasts = value;
					return [
						value,
						(update) => {
							toasts = typeof update === "function" ? update(toasts) : update;
						},
					];
				},
				useRef() {
					return { current: null };
				},
			};
		if (name === "react/jsx-runtime")
			return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
		if (name === "@/stores/useDataStore")
			return {
				useDataStore: {
					getState: () => data,
					subscribe(callback) {
						notify = callback;
						return () => {};
					},
				},
			};
		if (name === "@/stores/useLivePreferences") return { useLivePreferences: { getState: () => preferences } };
		if (name === "@/stores/useSettingsStore")
			return { useSettingsStore: { getState: () => ({ raceControlChime: false }) } };
		if (name === "./ReferenceContext") return { useReferenceContext: () => null };
		if (name === "next/image" || name === "./Icon") return () => null;
		throw new Error("Unexpected import: " + name);
	},
});
assert.equal(componentExports.eventStyle(incident).tone, "purple");
assert.equal(
	componentExports.eventStyle({ ...incident, Message: "FIA STEWARDS: INCIDENT WILL BE INVESTIGATED AFTER THE SESSION" })
		.name,
	"Investigation",
);
assert.equal(componentExports.eventStyle(historic).tone, "neutral");
assert.equal(componentExports.eventStyle({ ...incident, Flag: "YELLOW", Sector: 4 }).tone, "yellow");
assert.equal(componentExports.eventStyle({ ...incident, Message: "5 SECOND TIME PENALTY - TRACK LIMITS" }).tone, "red");
componentExports.EventNotifications();
assert.equal(toasts.length, 0);
function publish(messages, path = "session-a") {
	data = { state: { SessionInfo: { Path: path }, RaceControlMessages: { Messages: messages } } };
	notify(data);
}
publish([historic, incident]);
assert.equal(toasts.length, 1, "First new event after mounting with existing history must not be dropped");
publish([historic, incident]);
assert.equal(toasts.length, 1, "Repeated state must not create duplicate toasts");
preferences.notifications = false;
const muted = { ...incident, Utc: "2026-10-09T12:02:00", Message: "INCIDENT NOTED - CAR 44" };
publish([historic, incident, muted]);
assert.equal(toasts.length, 1);
preferences.notifications = true;
publish([historic, incident, muted]);
assert.equal(toasts.length, 1, "Enabling must not replay muted events");
publish([historic], "session-b");
assert.equal(toasts.length, 0, "Old session toasts must clear");
assert.equal(timers.size, 0, "Old timers must clear");
publish([historic, incident], "session-b");
assert.equal(toasts.length, 1);
cleanup();
assert.equal(timers.size, 0);
console.log(
	"Event regression: correct categories; loaded history suppressed; first fresh event retained; deduplication, mute/unmute and session reset verified.",
);
