export type BenchmarkRecord = {
	time: string;
	seconds: number;
	driver_name: string;
	constructor_name?: string;
	year: number;
};
export type CircuitContext = {
	latitude: number;
	longitude: number;
	circuit_track: string;
	position_x_min: number | null;
	position_x_max: number | null;
	position_y_min: number | null;
	position_y_max: number | null;
};
export type LiveContext = {
	circuit: CircuitContext | null;
	previous: BenchmarkRecord | null;
	lapRecord: BenchmarkRecord | null;
	trackRecord: BenchmarkRecord | null;
	portraits: Record<string, string>;
	logos: Record<string, string>;
	source: string;
};
