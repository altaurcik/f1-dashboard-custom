export type ComparisonLap = {
	lap: number | null;
	counter: number;
	value: string;
	seconds: number;
	at: number;
	excluded: string | null;
	compound: string | null;
	stint: number;
};
export type GapPoint = {
	at: number;
	gap: number | null;
	interval: number | null;
	ahead: string | null;
	position: number;
	leader: string | null;
	epoch: number;
	run: number;
};
export type Working = {
	count: number;
	dirty: string | null;
	completion: { counter: number; at: number; excluded: string | null; compound: string | null; stint: number } | null;
	report: { at: number; value: string; seconds: number; lap: number | null } | null;
	epoch: number;
	blocked: boolean;
	position: number;
};
export type ComparisonHistory = {
	session: string;
	part: number;
	track: string;
	run: number;
	runAt: number;
	offsets: Record<string, number>;
	laps: Record<string, ComparisonLap[]>;
	gaps: Record<string, GapPoint[]>;
	working: Record<string, Working>;
};
