import type { FeatureCollection, LineString } from "geojson";

export type CircuitFlagZone = { number: number; entry: number[]; exit: number[] };

// Snap actual marshal boundaries to the rendered closed circuit; never invent equal-length sectors.
export function createCircuitFlagSectors(
	coordinates: number[][],
	zones: CircuitFlagZone[],
): FeatureCollection<LineString, { sector: number }> {
	const result: FeatureCollection<LineString, { sector: number }> = { type: "FeatureCollection", features: [] };
	if (coordinates.length < 3) return result;
	const first = coordinates[0];
	const last = coordinates.at(-1)!;
	const line = first[0] === last[0] && first[1] === last[1] ? coordinates : [...coordinates, first];
	const size = line.length - 1;
	const longitudeScale = Math.cos((first[1] * Math.PI) / 180);
	function project(point: number[]) {
		let distance = Infinity;
		let progress = 0;
		let projected = line[0];
		for (let index = 0; index < size; index++) {
			const a = line[index];
			const b = line[index + 1];
			const dx = (b[0] - a[0]) * longitudeScale;
			const dy = b[1] - a[1];
			const lengthSquared = dx * dx + dy * dy;
			if (!lengthSquared) continue;
			const fraction = Math.max(
				0,
				Math.min(1, ((point[0] - a[0]) * longitudeScale * dx + (point[1] - a[1]) * dy) / lengthSquared),
			);
			const candidate = [a[0] + (b[0] - a[0]) * fraction, a[1] + dy * fraction];
			const candidateDistance = ((point[0] - candidate[0]) * longitudeScale) ** 2 + (point[1] - candidate[1]) ** 2;
			if (candidateDistance < distance) {
				distance = candidateDistance;
				progress = index + fraction;
				projected = candidate;
			}
		}
		return { progress, projected };
	}
	for (const zone of zones) {
		if (
			!Number.isInteger(zone.number) ||
			zone.number < 1 ||
			![zone.entry, zone.exit].every(
				(point) => point?.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]),
			)
		)
			continue;
		const start = project(zone.entry);
		const end = project(zone.exit);
		if (Math.abs(start.progress - end.progress) < 1e-9) continue;
		const endProgress = end.progress < start.progress ? end.progress + size : end.progress;
		const points = [start.projected];
		for (let index = Math.floor(start.progress) + 1; index < endProgress; index++) points.push(line[index % size]);
		points.push(end.projected);
		result.features.push({
			type: "Feature",
			properties: { sector: zone.number },
			geometry: { type: "LineString", coordinates: points },
		});
	}
	return result;
}
