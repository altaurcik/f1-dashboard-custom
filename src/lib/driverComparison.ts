import type { State } from "@/types/state.type";
import type { RecursivePartial } from "@/types/message.type";
import type { ComparisonHistory, ComparisonLap, Working } from "@/types/driver-comparison.type";
export type { ComparisonHistory } from "@/types/driver-comparison.type";
export const emptyComparisonHistory = (): ComparisonHistory => ({
	session: "",
	part: 0,
	track: "",
	run: 0,
	runAt: 0,
	offsets: {},
	laps: {},
	gaps: {},
	working: {},
});
export function timeSeconds(value: unknown): number | null {
	if (typeof value !== "string" || !/^\d+(?::\d{2})?(?:\.\d+)?$/.test(value)) return null;
	const parts = value.split(":").map(Number);
	const seconds = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
	return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}
function gapSeconds(value: unknown): number | null {
	if (typeof value !== "string" || !/^\+?\d+(?:\.\d+)?$/.test(value)) return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}
export const isRace = (state: State) =>
	/^(race|sprint)$/i.test(state.SessionInfo?.Type || "") || /^sprint$/i.test(state.SessionInfo?.Name || "");
const lapBlock = (state: State, n: string): string | null => {
	const driver = state.TimingData?.Lines[n];
	if (driver?.InPit || driver?.PitOut) return "Pit / out lap";
	if (driver?.Stopped || driver?.Retired) return "Stopped";
	if (state.TrackStatus?.Status !== "1") return state.TrackStatus ? "Yellow / SC / VSC / red" : "Flag state unknown";
	return null;
};
export function advanceComparison(
	history: ComparisonHistory,
	state: State,
	patch: RecursivePartial<State>,
	at: number,
	initial = false,
): ComparisonHistory {
	const session = state.SessionInfo?.Path || String(state.SessionInfo?.Key || "");
	const part = state.TimingData?.SessionPart || 0;
	if (!session) return history;
	if (session !== history.session || part !== history.part)
		history = {
			...emptyComparisonHistory(),
			session,
			part,
			offsets: session === history.session ? history.offsets : {},
		};
	if (!initial && !patch.TimingData && !patch.TrackStatus && !patch.TimingAppData && !patch.RaceControlMessages)
		return history;
	const track = state.TrackStatus?.Status || "";
	const run = history.run + (initial || track !== history.track ? 1 : 0);
	const result = {
		...history,
		track,
		run,
		runAt: initial || track !== history.track ? at : history.runAt,
		offsets: { ...history.offsets },
		laps: { ...history.laps },
		gaps: initial ? {} : { ...history.gaps },
		working: { ...history.working },
	};
	const lines = state.TimingData?.Lines || {};
	for (const [number, line] of Object.entries(lines)) {
		const count = line.NumberOfLaps;
		if (!Number.isInteger(count)) continue;
		const block = lapBlock(state, number);
		const previous = history.working[number];
		const work: Working = previous
			? { ...previous }
			: {
					count,
					dirty: "Partial lap",
					completion: null,
					report: null,
					epoch: 0,
					blocked: !!block,
					position: Number(line.Position),
				};
		if (initial && previous) {
			work.dirty = "Partial lap";
			work.completion = null;
			work.report = null;
			work.epoch++;
		}
		if (previous && count < previous.count) {
			result.laps[number] = [];
			result.gaps[number] = [];
			work.completion = null;
			work.report = null;
			work.dirty = "Timeline reset";
			delete result.offsets[number];
		}
		if (!!block !== work.blocked || Number(line.Position) !== work.position) work.epoch++;
		work.position = Number(line.Position);
		work.blocked = !!block;
		const stints = state.TimingAppData?.Lines[number]?.Stints || [];
		const stint = stints.length - 1;
		if (count > work.count) {
			work.completion = {
				counter: count,
				at,
				excluded: count - work.count > 1 ? "Missing laps" : work.dirty || block,
				compound: stints.at(-1)?.Compound || null,
				stint,
			};
			work.dirty = block;
		} else if (block) work.dirty = block;
		work.count = count;
		const raw = patch.TimingData?.Lines?.[number];
		const value = raw?.LastLapTime?.Value;
		const seconds = timeSeconds(value);
		if (!initial && typeof value === "string" && seconds !== null)
			work.report = {
				value,
				seconds,
				at,
				lap: Number.isInteger(raw?.LastLapTime?.Lap) ? raw!.LastLapTime!.Lap! : null,
			};
		// F1 emits lap count and LAST in separate packets. Pair only neighbouring updates,
		// never assign an initial/stale LAST value to a newly incremented lap counter.
		if (work.report && work.completion && Math.abs(work.report.at - work.completion.at) <= 5000) {
			const nativeLap =
				work.report.lap ??
				(raw?.BestLapTime?.Value === work.report.value && Number.isInteger(raw.BestLapTime.Lap)
					? raw.BestLapTime.Lap!
					: null);
			const offset = nativeLap !== null ? work.completion.counter - nativeLap : null;
			if (offset === 0 || offset === 1) {
				result.offsets[number] = offset;
				result.laps[number] = (result.laps[number] || []).map((old) => ({ ...old, lap: old.counter - offset }));
			}
			const lap = {
				...work.completion,
				lap:
					nativeLap ?? (result.offsets[number] !== undefined ? work.completion.counter - result.offsets[number] : null),
				value: work.report.value,
				seconds: work.report.seconds,
			};
			result.laps[number] = [...(result.laps[number] || []).filter((old) => old.counter !== lap.counter), lap]
				.sort((a, b) => a.counter - b.counter)
				.slice(-24);
			work.report = null;
		}
		if (!initial && raw && ("GapToLeader" in raw || "IntervalToPositionAhead" in raw)) {
			const position = Number(line.Position);
			const gap = position === 1 ? 0 : gapSeconds(line.GapToLeader);
			const interval = gapSeconds(line.IntervalToPositionAhead?.Value);
			const ahead = Object.entries(lines).find(([, driver]) => Number(driver.Position) === position - 1)?.[0] || null;
			const leader = Object.entries(lines).find(([, driver]) => Number(driver.Position) === 1)?.[0] || null;
			const points = result.gaps[number] || [];
			if (!block && (!points.length || at - points.at(-1)!.at >= 2000))
				result.gaps[number] = [...points, { at, gap, interval, ahead, leader, position, epoch: work.epoch, run }].slice(
					-100,
				);
		}
		result.working[number] = work;
	}
	return result;
}
export function lapDeleted(lap: ComparisonLap, number: string, state: State): boolean {
	return (state.RaceControlMessages?.Messages || []).some((message) => {
		const match = message.Message.match(/\bCAR\s+(\d+)\b.*?\bTIME\s+(\d+:\d{2}\.\d{3})\s+DELETED\b.*?\bLAP\s+(\d+)\b/i);
		return match?.[1] === number && match[2] === lap.value && (lap.lap === null || Number(match[3]) === lap.lap);
	});
}
export function recentLaps(history: ComparisonHistory, number: string, state: State, count: number) {
	const rows = (history.laps[number] || []).map((lap) => ({
		...lap,
		excluded: lapDeleted(lap, number, state) ? "Deleted" : lap.excluded,
	}));
	const currentStint = (state.TimingAppData?.Lines[number]?.Stints?.length || 0) - 1;
	const clean = rows.slice(-count).filter((lap) => !lap.excluded && lap.stint === currentStint);
	const average = clean.length ? clean.reduce((total, lap) => total + lap.seconds, 0) / clean.length : null;
	return { rows: rows.slice(-count).reverse(), clean, average };
}
export function raceGap(state: State, a: string, b: string) {
	const A = state.TimingData?.Lines[a],
		B = state.TimingData?.Lines[b];
	if (!isRace(state))
		return {
			front: a,
			behind: b,
			seconds: null,
			reason: "Qualifying / practice: lap times are not an on-track gap.",
			adjacent: false,
		};
	if (!A || !B || !(Number(A.Position) > 0) || !(Number(B.Position) > 0) || A.Position === B.Position)
		return { front: a, behind: b, seconds: null, reason: "Race positions unavailable.", adjacent: false };
	const front = Number(A.Position) < Number(B.Position) ? a : b,
		behind = front === a ? b : a;
	const F = state.TimingData!.Lines[front],
		R = state.TimingData!.Lines[behind];
	const adjacent = Number(R.Position) - Number(F.Position) === 1;
	if (
		/LAP/i.test(F.GapToLeader || "") ||
		/LAP/i.test(R.GapToLeader || "") ||
		/LAP/i.test(R.IntervalToPositionAhead?.Value || "")
	)
		return { front, behind, seconds: null, reason: "Lap separation: a time gap cannot be calculated.", adjacent };
	const f = Number(F.Position) === 1 ? 0 : gapSeconds(F.GapToLeader),
		r = gapSeconds(R.GapToLeader);
	const interval = adjacent ? gapSeconds(R.IntervalToPositionAhead?.Value) : null;
	const seconds = interval ?? (f !== null && r !== null && r >= f ? r - f : null);
	return { front, behind, seconds, reason: seconds === null ? "Timing gap unavailable." : "", adjacent };
}
export function compareDrivers(
	state: State,
	history: ComparisonHistory,
	a: string,
	b: string,
	count: number,
	at: number,
	paused: boolean,
	connected: boolean,
) {
	const race = isRace(state),
		gap = raceGap(state, a, b),
		A = recentLaps(history, a, state, count),
		B = recentLaps(history, b, state, count);
	const delta = A.average !== null && B.average !== null ? A.average - B.average : null;
	const bestA = timeSeconds(state.TimingData?.Lines[a]?.BestLapTime?.Value),
		bestB = timeSeconds(state.TimingData?.Lines[b]?.BestLapTime?.Value);
	const bestDelta = bestA !== null && bestB !== null ? bestA - bestB : null;
	const points: { at: number; gap: number }[] = [];
	const fresh = (number: string) =>
		(history.gaps[number] || []).filter(
			(p) => p.run === history.run && p.epoch === history.working[number]?.epoch && p.at >= at - 120000 && p.at <= at,
		);
	const rear = fresh(gap.behind),
		front = fresh(gap.front);
	if (race)
		for (const point of rear) {
			if (gap.adjacent && point.ahead === gap.front && point.interval !== null) {
				points.push({ at: point.at, gap: point.interval });
				continue;
			}
			if (!gap.adjacent && point.gap !== null) {
				if (Number(state.TimingData?.Lines[gap.front]?.Position) === 1 && point.leader === gap.front) {
					points.push({ at: point.at, gap: point.gap });
					continue;
				}
				const f = front.findLast((p) => p.at <= point.at && point.at - p.at <= 20000 && p.leader === point.leader);
				if (f?.gap !== null && f?.gap !== undefined && point.gap >= f.gap)
					points.push({ at: point.at, gap: point.gap - f.gap });
			}
		}
	let closingPerMinute: number | null = null;
	if (points.length >= 3 && points.at(-1)!.at - points[0].at >= 30000 && at - points.at(-1)!.at <= 45000) {
		const xs = points.map((p) => (p.at - points[0].at) / 60000),
			mx = xs.reduce((s, x) => s + x, 0) / xs.length,
			my = points.reduce((s, p) => s + p.gap, 0) / points.length;
		const denominator = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
		closingPerMinute = -xs.reduce((s, x, i) => s + (x - mx) * (points[i].gap - my), 0) / denominator;
	}
	let verdict: "catching" | "falling" | "steady" | "pace" | "waiting" | "blocked" = "waiting";
	let reason = "Collecting at least 30s of gap updates.";
	if (!race) {
		verdict = "pace";
		reason = "Compare lap times; catching cannot be inferred in this session.";
	} else if (
		paused ||
		!connected ||
		state.SessionStatus?.Status !== "Started" ||
		lapBlock(state, a) ||
		lapBlock(state, b)
	) {
		verdict = "blocked";
		reason = paused
			? "Playback paused."
			: !connected
				? "Feed disconnected."
				: state.SessionStatus?.Status !== "Started"
					? "Session is not running."
					: lapBlock(state, a) || lapBlock(state, b) || "";
	} else if (gap.seconds === null) {
		verdict = "blocked";
		reason = gap.reason;
	} else if (closingPerMinute !== null) {
		verdict = closingPerMinute > 0.15 ? "catching" : closingPerMinute < -0.15 ? "falling" : "steady";
		reason = "Gap trend over the last " + Math.round((points.at(-1)!.at - points[0].at) / 1000) + "s.";
	}
	const frontAvg = gap.front === a ? A.average : B.average,
		behindAvg = gap.behind === a ? A.average : B.average;
	const paceGain = frontAvg !== null && behindAvg !== null ? frontAvg - behindAvg : null;
	const estimate =
		verdict === "catching" &&
		gap.seconds !== null &&
		closingPerMinute !== null &&
		A.clean.filter((lap) => lap.at >= history.runAt && at - lap.at <= 300000).length >= 3 &&
		B.clean.filter((lap) => lap.at >= history.runAt && at - lap.at <= 300000).length >= 3 &&
		behindAvg !== null &&
		paceGain !== null &&
		paceGain > 0.05
			? gap.seconds / ((closingPerMinute * behindAvg) / 60)
			: null;
	return { race, gap, A, B, delta, bestDelta, points, closingPerMinute, verdict, reason, estimate, paceGain };
}
