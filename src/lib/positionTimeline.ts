import type { PositionCar, PositionItem } from "@/types/state.type";

type Sample = PositionCar & { time: number };
const trails = new Map<string, Sample[]>();
let originTime: number | null = null;
let originPerformance = 0;
let lastReceived = 0;
let latestTimestamp: number | null = null;

export function resetPositionTimeline() {
	trails.clear();
	originTime = null;
	lastReceived = 0;
	latestTimestamp = null;
}

export function ingestPositionFrames(frames: PositionItem[]) {
	let newest = -Infinity;
	for (const frame of frames) {
		const time = Date.parse(frame.Timestamp);
		if (!Number.isFinite(time)) continue;
		newest = Math.max(newest, time);
		for (const [number, car] of Object.entries(frame.Entries ?? {})) {
			if (!Number.isFinite(car.X) || !Number.isFinite(car.Y)) continue;
			const samples = trails.get(number) ?? [];
			const sample = { ...car, time };
			if (!samples.length || time > samples[samples.length - 1].time) samples.push(sample);
			else {
				const index = samples.findIndex((item) => item.time >= time);
				if (index >= 0 && samples[index].time === time) samples[index] = sample;
				else samples.splice(index >= 0 ? index : samples.length, 0, sample);
			}
			while (samples.length > 2 && samples[1].time < time - 600_000) samples.shift();
			trails.set(number, samples);
		}
	}
	if (Number.isFinite(newest)) {
		const now = performance.now();
		if (originTime === null || Math.abs(newest - (originTime + now - originPerformance)) > 10_000) {
			originTime = newest;
			originPerformance = now;
		}
		latestTimestamp = Math.max(latestTimestamp ?? -Infinity, newest);
		lastReceived = now;
	}
}

export function getPositionTime(delaySeconds = 0, now = performance.now()) {
	return originTime === null ? null : originTime + now - originPerformance - 2000 - Math.max(0, delaySeconds) * 1000;
}

export function getDriverPositionAt(number: string, time: number | null): PositionCar | null {
	const samples = trails.get(number);
	if (!samples?.length || time === null) return null;
	if (time <= samples[0].time) return samples[0];
	if (time >= samples[samples.length - 1].time) return samples[samples.length - 1];
	let left = 0;
	let right = samples.length - 1;
	while (right - left > 1) {
		const middle = Math.floor((left + right) / 2);
		if (samples[middle].time <= time) left = middle;
		else right = middle;
	}
	const a = samples[left];
	const b = samples[right];
	// A long outage or a changed positional status must not create a journey across the circuit.
	if (b.time - a.time > 3000 || a.Status !== b.Status) return a;
	const fraction = (time - a.time) / (b.time - a.time);
	return {
		Status: a.Status,
		X: a.X + (b.X - a.X) * fraction,
		Y: a.Y + (b.Y - a.Y) * fraction,
		Z: a.Z + (b.Z - a.Z) * fraction,
	};
}

export function getPositionFeedStatus() {
	return {
		available: trails.size > 0,
		stale:
			latestTimestamp !== null && (Date.now() - latestTimestamp > 10_000 || performance.now() - lastReceived > 10_000),
		lastTimestamp: latestTimestamp,
	};
}
