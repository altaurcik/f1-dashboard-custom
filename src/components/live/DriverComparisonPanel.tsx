"use client";
import { Fragment, useEffect, useState } from "react";
import { useDataStore } from "@/stores/useDataStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useLivePreferences } from "@/stores/useLivePreferences";
import { compareDrivers } from "@/lib/driverComparison";
import { isLastLapDeleted } from "@/lib/timingConsistency";
import { useLiveConnection } from "./LiveConnection";
import Icon from "./Icon";

const secondsLabel = (value: number | null, signed = false) =>
	value === null ? "—" : (signed && value > 0 ? "+" : "") + value.toFixed(3) + "s";
const lapLabel = (value: number | null) =>
	value === null ? "—" : Math.floor(value / 60) + ":" + (value % 60).toFixed(3).padStart(6, "0");
export default function DriverComparisonPanel() {
	const data = useDataStore((s) => s.state);
	const history = useDataStore((s) => s.comparison);
	const selected = useLivePreferences((s) => s.selected);
	const update = useLivePreferences((s) => s.update);
	const delay = useSettingsStore((s) => s.delay),
		paused = useSettingsStore((s) => s.delayIsPaused);
	const connected = useLiveConnection();
	const [window, setWindow] = useState(5);
	const [now, setNow] = useState(0);
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	const a = selected[0],
		b = selected[1];
	const drivers = Object.values(data?.DriverList || {})
		.filter((driver) => typeof driver?.RacingNumber === "string" && /^\d+$/.test(driver.RacingNumber))
		.sort(
			(x, y) =>
				Number(data?.TimingData?.Lines[x.RacingNumber]?.Position || 99) -
				Number(data?.TimingData?.Lines[y.RacingNumber]?.Position || 99),
		);
	const result =
		data && a && b ? compareDrivers(data, history, a, b, window, now - delay * 1000, paused, connected) : null;
	const tla = (number: string) => data?.DriverList?.[number]?.Tla || number;
	const choose = (slot: number, value: string) => {
		const pair = [...selected];
		pair[slot] = value;
		update({ selected: pair.filter(Boolean) });
	};
	let headline = "Select two drivers to compare";
	if (result) {
		const behind = tla(result.gap.behind),
			front = tla(result.gap.front);
		if (result.verdict === "catching") headline = behind + " is catching " + front;
		else if (result.verdict === "falling") headline = behind + " is losing ground to " + front;
		else if (result.verdict === "steady") headline = "The gap is stable";
		else if (result.verdict === "blocked") headline = "Chase assessment paused";
		else if (result.verdict === "waiting") headline = "Measuring the gap trend";
		else if (result.A.clean.length >= 3 && result.B.clean.length >= 3 && result.delta !== null)
			headline =
				Math.abs(result.delta) < 0.05
					? "Recent pace is similar"
					: tla(result.delta < 0 ? a : b) + " is faster on recent laps";
		else if (result.bestDelta !== null)
			headline =
				Math.abs(result.bestDelta) < 0.001
					? "Best lap times are equal"
					: tla(result.bestDelta < 0 ? a : b) + " has the faster best lap";
		else headline = "Waiting for timed laps";
	}
	return (
		<section className="live-panel live-driver-comparison">
			<header className="live-panel-header">
				<h2>
					<Icon name="gauge" />
					Driver comparison
				</h2>
				<label className="comparison-window">
					Recent laps
					<select aria-label="Comparison lap window" value={window} onChange={(e) => setWindow(Number(e.target.value))}>
						{[3, 5, 10].map((n) => (
							<option key={n} value={n}>
								{n}
							</option>
						))}
					</select>
				</label>
			</header>
			<div className="comparison-body">
				<div className="comparison-selectors" role="group" aria-label="Drivers to compare">
					{[0, 1].map((slot) => {
						const driver = data?.DriverList?.[selected[slot]];
						const position = data?.TimingData?.Lines[selected[slot]]?.Position;
						const compound = data?.TimingAppData?.Lines[selected[slot]]?.Stints?.at(-1)?.Compound;
						return (
							<Fragment key={slot}>
								{slot === 1 && (
									<span className="comparison-versus" aria-hidden="true">
										vs
									</span>
								)}
								<label
									className={"comparison-driver-picker" + (slot === 1 && !a ? " is-disabled" : "")}
									title={
										driver
											? [driver.FullName, position ? "P" + position : null, compound].filter(Boolean).join(" · ")
											: "Choose driver " + (slot === 0 ? "A" : "B")
									}
								>
									<i aria-hidden="true" style={{ backgroundColor: "#" + (driver?.TeamColour || "64748b") }} />
									<span className="comparison-driver-code" aria-hidden="true">
										{driver?.Tla || "Driver " + (slot + 1)}
									</span>
									{driver && position && (
										<span className="comparison-driver-position" aria-hidden="true">
											P{position}
										</span>
									)}
									<span className="comparison-driver-chevron" aria-hidden="true">
										▾
									</span>
									<select
										aria-label={"Comparison driver " + (slot === 0 ? "A" : "B")}
										value={selected[slot] || ""}
										disabled={slot === 1 && !a}
										onChange={(e) => choose(slot, e.target.value)}
									>
										<option value="">Select driver</option>
										{drivers.map((driver) => (
											<option
												key={driver.RacingNumber}
												value={driver.RacingNumber}
												disabled={selected[1 - slot] === driver.RacingNumber}
											>
												{driver.Tla} · {driver.FullName}
											</option>
										))}
									</select>
								</label>
							</Fragment>
						);
					})}
				</div>
				<div className={"comparison-verdict verdict-" + (result?.verdict || "waiting")}>
					<strong>{headline}</strong>
					<p>
						{result?.reason || "Choose here or select two drivers in the leaderboard. Selection also controls the map."}
					</p>
				</div>
				{result && data && (
					<>
						{result.race && result.paceGain !== null && result.A.clean.length >= 3 && result.B.clean.length >= 3 && (
							<p className="comparison-pace-line">
								Recent pace:{" "}
								{Math.abs(result.paceGain) < 0.05
									? "similar lap times"
									: tla(result.paceGain > 0 ? result.gap.behind : result.gap.front) +
										" is " +
										Math.abs(result.paceGain).toFixed(3) +
										"s/lap faster"}
							</p>
						)}
						<div className="comparison-metrics">
							<div>
								<span>{result.race ? "TIMING GAP" : "BEST LAP DIFFERENCE"}</span>
								<strong>{secondsLabel(result.race ? result.gap.seconds : result.bestDelta, !result.race)}</strong>
								<small>
									{result.race ? `${tla(result.gap.behind)} behind ${tla(result.gap.front)}` : `${tla(a)} − ${tla(b)}`}
								</small>
							</div>
							<div>
								<span>{result.race ? "GAP CHANGE" : "RECENT PACE DIFFERENCE"}</span>
								<strong>
									{result.race
										? result.closingPerMinute !== null && result.verdict !== "blocked"
											? secondsLabel(-result.closingPerMinute, true) + "/min"
											: "—"
										: secondsLabel(result.delta, true)}
								</strong>
								<small>{result.race ? "Negative = gap shrinking" : `${tla(a)} − ${tla(b)} · clean laps`}</small>
							</div>
							<div>
								<span>AVERAGE · {tla(a)}</span>
								<strong>{lapLabel(result.A.average)}</strong>
								<small>
									{result.A.clean.length}/{window} clean laps · current stint
								</small>
							</div>
							<div>
								<span>AVERAGE · {tla(b)}</span>
								<strong>{lapLabel(result.B.average)}</strong>
								<small>
									{result.B.clean.length}/{window} clean laps · current stint
								</small>
							</div>
						</div>
						<div className="comparison-details">
							<div className="comparison-laps">
								<div className="comparison-section-title">
									<b>Recent laps</b>
									<small>{window} most recent observed</small>
								</div>
								<div className="comparison-lap-scroll">
									<table>
										<thead>
											<tr>
												<th>{tla(a)}</th>
												<th>TIME</th>
												<th>{tla(b)}</th>
												<th>TIME</th>
												<th>Δ A − B</th>
											</tr>
										</thead>
										<tbody>
											{Array.from({ length: Math.max(result.A.rows.length, result.B.rows.length) }).map((_, i) => {
												const A = result.A.rows[i],
													B = result.B.rows[i];
												const delta = A && B && !A.excluded && !B.excluded ? A.seconds - B.seconds : null;
												return (
													<tr key={i}>
														<td>{A?.lap !== null && A?.lap !== undefined ? "L" + A.lap : "—"}</td>
														<td title={A?.excluded || "Timed lap"} className={A?.excluded ? "lap-excluded" : ""}>
															{A?.value || "—"}
															{A?.excluded && <small>{A.excluded}</small>}
														</td>
														<td>{B?.lap !== null && B?.lap !== undefined ? "L" + B.lap : "—"}</td>
														<td title={B?.excluded || "Timed lap"} className={B?.excluded ? "lap-excluded" : ""}>
															{B?.value || "—"}
															{B?.excluded && <small>{B.excluded}</small>}
														</td>
														<td>{secondsLabel(delta, true)}</td>
													</tr>
												);
											})}
											{!result.A.rows.length && !result.B.rows.length && (
												<tr>
													<td colSpan={5} className="comparison-no-laps">
														Full laps accumulate while this dashboard is open.
													</td>
												</tr>
											)}
										</tbody>
									</table>
								</div>
								<div className="comparison-last">
									<span>Last reported</span>
									{[a, b].map((n) => {
										const timing = data.TimingData?.Lines[n];
										const deleted = timing && isLastLapDeleted(timing, data.RaceControlMessages?.Messages);
										return (
											<span key={n} className={deleted ? "lap-excluded" : ""}>
												{tla(n)} <b>{timing?.LastLapTime?.Value || "—"}</b>
												{deleted ? " · deleted" : ""}
											</span>
										);
									})}
								</div>
							</div>
							<div className="comparison-trend">
								<div className="comparison-section-title">
									<b>{result.race ? "Gap over time" : "Session best"}</b>
									<small>{result.race ? "Last 2 minutes" : "Official timing"}</small>
								</div>
								{result.race ? (
									<GapChart points={result.points} />
								) : (
									<div className="comparison-bests">
										{[a, b].map((n) => (
											<div key={n}>
												<span>{tla(n)}</span>
												<b>{data.TimingData?.Lines[n]?.BestLapTime?.Value || "—"}</b>
											</div>
										))}
									</div>
								)}
								{result.estimate !== null && (
									<p className="comparison-estimate">
										At this rate: ~{Math.ceil(result.estimate)} laps to close the gap.{" "}
										<small>Estimate assumes unchanged pace and no stops.</small>
									</p>
								)}
								{result.race && result.estimate === null && (
									<p className="comparison-note">
										Catch estimate needs a shrinking gap and at least 3 clean laps per driver.
									</p>
								)}
							</div>
						</div>
						<p className="comparison-footnote">
							Pit/out laps, cautions and deleted times are excluded from average pace. Lap history starts when the feed
							is opened; gaps are in seconds, not metres.
						</p>
					</>
				)}
			</div>
		</section>
	);
}
function GapChart({ points }: { points: { at: number; gap: number }[] }) {
	if (points.length < 4) return <div className="comparison-chart-empty">Collecting timing updates…</div>;
	const min = Math.min(...points.map((p) => p.gap)),
		max = Math.max(...points.map((p) => p.gap)),
		range = Math.max(0.2, max - min);
	const start = points[0].at,
		end = points.at(-1)!.at;
	return (
		<div className="comparison-gap-chart">
			<svg
				viewBox="0 0 300 90"
				role="img"
				aria-label={`Gap changed from ${points[0].gap.toFixed(3)} to ${points.at(-1)!.gap.toFixed(3)} seconds.`}
			>
				<path d="M5 15H295M5 45H295M5 75H295" stroke="var(--live-border)" />
				<polyline
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					points={points
						.map((p) => `${5 + (290 * (p.at - start)) / Math.max(1, end - start)},${75 - (60 * (p.gap - min)) / range}`)
						.join(" ")}
				/>
			</svg>
			<div>
				<span>{points[0].gap.toFixed(3)}s</span>
				<span>{points.at(-1)!.gap.toFixed(3)}s · latest</span>
			</div>
		</div>
	);
}
