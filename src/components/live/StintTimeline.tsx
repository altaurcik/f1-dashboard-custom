import clsx from "clsx";
import { buildTyreRuns, getLapAxis } from "@/lib/stintTimeline";
import type { Stint } from "@/types/state.type";

export function StintAxis({ maxLaps, race }: { maxLaps: number | null; race: boolean }) {
	return (
		<div
			className="live-stint-axis"
			aria-label={
				maxLaps === null
					? "Race distance unavailable"
					: `${race ? "Race distance" : "Session maximum"}: ${maxLaps} laps`
			}
		>
			{getLapAxis(maxLaps).map((lap) => (
				<span key={lap} style={{ left: maxLaps ? `${(lap / maxLaps) * 100}%` : "0%" }}>
					{lap}
				</span>
			))}
		</div>
	);
}

export default function StintTimeline({ stints, maxLaps }: { stints?: Stint[]; maxLaps: number | null }) {
	const runs = buildTyreRuns(stints);
	if (!maxLaps || !runs.length)
		return (
			<span
				className="live-muted"
				title={maxLaps === null ? "Waiting for the total race distance" : "No tyre distance data yet"}
			>
				—
			</span>
		);
	return (
		<div className="live-stint-timeline" data-lap-scale={maxLaps}>
			{runs.map((run, index) => {
				const last = index === runs.length - 1;
				const description = `${run.compound.toUpperCase()} · ${run.distance} laps in this session · tyre age ${run.age} laps · ${run.condition} · session laps ${run.start + 1}–${run.end}`;
				return (
					<div
						key={index}
						role="img"
						aria-label={description}
						title={description}
						className={clsx("live-stint-block", `stint-${run.compound}`, { "live-stint-used": run.used })}
						data-start-lap={run.start}
						data-end-lap={run.end}
						data-distance={run.distance}
						style={{
							left: `${Math.min(run.start / maxLaps, 1) * 100}%`,
							width: `${(Math.max(0, Math.min(run.end, maxLaps) - Math.min(run.start, maxLaps)) / maxLaps) * 100}%`,
						}}
					>
						<span className="live-stint-track" aria-hidden="true" />
						<span
							className="live-stint-tyre"
							aria-hidden="true"
							style={{ backgroundImage: `url(/tires/${run.compound}.svg)` }}
						/>
						{last ? (
							<span className="live-stint-end" aria-hidden="true">
								{run.distance}
							</span>
						) : (
							<span className="live-stint-count" aria-hidden="true">
								{run.distance}
							</span>
						)}
					</div>
				);
			})}
		</div>
	);
}
