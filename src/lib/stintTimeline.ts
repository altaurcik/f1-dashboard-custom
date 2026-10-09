import type { Stint } from "@/types/state.type";

export function getStintLapScale(
	type: string | undefined,
	name: string | undefined,
	totalLaps: number | undefined,
	completedLaps: number[],
) {
	const race = [type, name].some((value) => /^(race|sprint|sprint race)$/i.test(value ?? ""));
	if (race) return totalLaps !== undefined && Number.isFinite(totalLaps) && totalLaps > 0 ? totalLaps : null;
	return Math.max(0, ...completedLaps.filter((laps) => Number.isFinite(laps) && laps >= 0));
}

export type TyreRun = {
	start: number;
	end: number;
	distance: number;
	compound: string;
	used: boolean;
	condition: "new" | "used" | "unknown";
	age: number;
	fittedAge: number;
};

export function buildTyreRuns(stints: Stint[] | undefined): TyreRun[] {
	const runs: TyreRun[] = [];
	for (const stint of stints ?? []) {
		if (stint.TotalLaps === undefined || !Number.isFinite(stint.TotalLaps)) continue;
		const startAge = stint.StartLaps ?? 0;
		const distance = Math.max(0, stint.TotalLaps - startAge);
		if (!distance) continue;
		const compound = stint.Compound?.toLowerCase() ?? "unknown";
		const previous = runs[runs.length - 1];
		const fresh = String(stint.New).toLowerCase() === "true";
		const unchanged = /^(1|true)$/i.test(String(stint.TyresNotChanged)) && !fresh;
		if (unchanged && previous?.compound === compound && stint.TotalLaps >= previous.age) {
			// A stop without a tyre change continues the same set, including age recorded at the stop.
			previous.distance = Math.max(previous.distance, stint.TotalLaps - previous.fittedAge);
			previous.end = previous.start + previous.distance;
			previous.age = stint.TotalLaps;
		} else {
			const start = previous?.end ?? 0;
			runs.push({
				start,
				end: start + distance,
				distance,
				compound,
				used: String(stint.New).toLowerCase() === "false" || startAge > 0,
				condition:
					fresh && startAge === 0
						? "new"
						: String(stint.New).toLowerCase() === "false" || startAge > 0
							? "used"
							: "unknown",
				age: stint.TotalLaps,
				fittedAge: startAge,
			});
		}
	}
	return runs;
}

export function getLapAxis(scale: number | null) {
	if (!scale || scale < 0) return [0];
	const step = scale > 40 ? 10 : scale > 10 ? 5 : scale > 5 ? 2 : 1;
	const ticks = [0];
	for (let lap = step; lap < scale; lap += step) if (scale - lap >= step * 0.6) ticks.push(lap);
	ticks.push(scale);
	return ticks;
}
