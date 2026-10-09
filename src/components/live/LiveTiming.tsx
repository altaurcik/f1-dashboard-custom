"use client";
import { useEffect, useState, Fragment, type ReactNode } from "react";
import dynamic from "next/dynamic";
import clsx from "clsx";
import { useDataStore } from "@/stores/useDataStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useLivePreferences, type LiveLayout } from "@/stores/useLivePreferences";
import Icon from "./Icon";
import StintTimeline, { StintAxis } from "./StintTimeline";
import { getStintLapScale } from "@/lib/stintTimeline";
import { canShowQualifyingGap, isLastLapDeleted, isIntermediateQualifyingFinish } from "@/lib/timingConsistency";
import { ReferenceContext, useReferenceContext } from "./ReferenceContext";
import type { LiveContext } from "@/types/live-context.type";
import { useLiveConnection } from "./LiveConnection";
import type { CameraView } from "@/types/live-view.type";
import Map from "@/components/dashboard/Map";
import { EventNotifications, RaceEventsPanel, RadioPanel } from "./EventPanels";
import { getPositionFeedStatus } from "@/lib/positionTimeline";
import type { Driver, Stint, TimingDataDriver } from "@/types/state.type";
import "./live-timing.css";
const TrackScene = dynamic(() => import("./GeographicTrackScene"), {
	ssr: false,
	loading: () => <div className="live-map-error">Loading 3D circuit…</div>,
});

function Panel({
	title,
	icon,
	actions,
	children,
	className = "",
}: {
	title: string;
	icon: string;
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section className={clsx("live-panel", className)}>
			<header className="live-panel-header">
				<h2>
					<Icon name={icon} />
					{title}
				</h2>
				{actions}
			</header>
			{children}
		</section>
	);
}

export default function LiveTiming() {
	const prefs = useLivePreferences();
	const [layoutMenu, setLayoutMenu] = useState(false);
	const connected = useLiveConnection();
	const sessionInfo = useDataStore((state) => state.state?.SessionInfo);
	const [reference, setReference] = useState<LiveContext | null>(null);
	useEffect(() => {
		if (!sessionInfo) return;
		const abort = new AbortController();
		fetch(
			`/api/live-context?year=${sessionInfo.StartDate.slice(0, 4)}&meeting=${sessionInfo.Meeting.Key}&session=${sessionInfo.Key}`,
			{ signal: abort.signal },
		)
			.then((response) => response.json())
			.then((value) => {
				if (!abort.signal.aborted) setReference(value);
			})
			.catch(() => {});
		return () => abort.abort();
	}, [sessionInfo]);
	useEffect(() => {
		void useLivePreferences.persist.rehydrate();
	}, []);

	return (
		<ReferenceContext.Provider value={reference}>
			<div
				className={clsx("live-timing", "live-theme-" + prefs.theme, {
					"live-compact": prefs.compact,
				})}
			>
				<EventNotifications />
				<main className="live-main">
					<div className="live-topbar">
						<Icon name="live" />
						<strong>Live Timing</strong>
						<div className="live-topbar-actions">
							<div className="live-dropdown">
								<button aria-label="Layout settings" onClick={() => setLayoutMenu(!layoutMenu)}>
									<Icon name="sliders" />
									Layout
								</button>
								{layoutMenu && (
									<div className="live-menu" role="dialog" aria-label="Layout settings">
										<strong>Layout</strong>
										{(
											[
												["stacked", "Stacked", "Map above the leaderboard."],
												["side", "Side by side", "Leaderboard left, map right."],
												["columns", "Three columns", "Map in the centre."],
											] as [LiveLayout, string, string][]
										).map(([value, title, description]) => (
											<button
												key={value}
												aria-pressed={prefs.layout === value}
												onClick={() => {
													prefs.update({ layout: value });
													setLayoutMenu(false);
												}}
											>
												<Icon name="grid" />
												<span>
													<b>{title}</b>
													<small>{description}</small>
												</span>
												{prefs.layout === value && <span>✓</span>}
											</button>
										))}
									</div>
								)}
							</div>
							<button
								aria-label="Toggle theme"
								onClick={() => prefs.update({ theme: prefs.theme === "dark" ? "light" : "dark" })}
							>
								<Icon name="sun" />
							</button>
						</div>
					</div>
					<SessionHeader connected={connected} />
					<div className={"live-workspace live-layout-" + prefs.layout}>
						<TimingTable />
						<div className="live-map-column">
							<TrackPanel />
							<div className="live-support-grid">
								<TelemetryPanel />
								<BenchmarksPanel />
								<RaceEventsPanel />
								<RadioPanel />
							</div>
						</div>
					</div>
				</main>
			</div>
		</ReferenceContext.Provider>
	);
}

function SessionHeader({ connected }: { connected: boolean }) {
	const info = useDataStore((s) => s.state?.SessionInfo);
	const clock = useDataStore((s) => s.state?.ExtrapolatedClock);
	const weather = useDataStore((s) => s.state?.WeatherData);
	const track = useDataStore((s) => s.state?.TrackStatus);
	const session = useDataStore((s) => s.state?.SessionStatus?.Status);
	const part = useDataStore((s) => s.state?.TimingData?.SessionPart);
	const [syncOpen, setSyncOpen] = useState(false);
	const delay = useSettingsStore((s) => s.delay);
	const setDelay = useSettingsStore((s) => s.setDelay);
	const [remaining, setRemaining] = useState("--:--:--");
	useEffect(() => {
		const update = () => {
			if (!clock) return;
			const parts = clock.Remaining.split(":").map(Number);
			const total = parts[0] * 3600 + parts[1] * 60 + parts[2];
			const elapsed =
				clock.Extrapolating && session === "Started" ? (Date.now() - Date.parse(clock.Utc)) / 1000 - delay : 0;
			const value = Math.max(0, Math.floor(total - elapsed));
			setRemaining(
				[Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60]
					.map((n) => String(n).padStart(2, "0"))
					.join(":"),
			);
		};
		const timer = setInterval(update, 500);
		return () => clearInterval(timer);
	}, [clock, session, delay]);
	const status = track?.Status === "1" ? "Track clear" : track?.Message || "Waiting for track status";
	const partFinished = isIntermediateQualifyingFinish(info?.Type, info?.Name, session, part);
	const ended = session && ["Ends", "Finished", "Finalised"].includes(session) && !partFinished;
	const partLabel = `${/sprint|shootout/i.test(info?.Name ?? "") ? "SQ" : "Q"}${part} FINISHED`;
	return (
		<div className="live-session-header">
			<div className="live-session-title">
				<div>
					<h1>{info?.Meeting.Name || "Formula 1 Live Timing"}</h1>
					<span>{info?.Name.toUpperCase() || "WAITING FOR SESSION"}</span>
				</div>
				{!ended && (
					<span className="live-pill">
						<Icon name="clock" size={13} />
						{remaining}
					</span>
				)}
				<span
					className={clsx(
						"live-pill live-status",
						ended || partFinished ? "finished" : connected ? "on-air" : "offline",
					)}
				>
					<i />
					{ended ? "FINISHED" : partFinished ? partLabel : connected ? "LIVE" : "CONNECTING"}
				</span>
				{!ended && (
					<span className={clsx("live-pill live-track-status", `track-status-${track?.Status ?? "unknown"}`)}>
						<Icon name="flag" size={12} />
						{status.toUpperCase()}
					</span>
				)}
				<div className="live-dropdown">
					<button className="live-pill" onClick={() => setSyncOpen(!syncOpen)}>
						<Icon name="monitor" size={14} />
						TV Sync{delay > 0 && <b>{delay}s</b>}
					</button>
					{syncOpen && (
						<div className="live-menu live-sync-menu">
							<strong>Sync with broadcast</strong>
							<p>Delay the dashboard to match your video stream.</p>
							<label>
								Delay{" "}
								<input
									aria-label="Broadcast delay"
									type="number"
									min="0"
									max="300"
									value={delay}
									onChange={(e) => setDelay(Math.min(300, Math.max(0, Number(e.target.value))))}
								/>
								seconds
							</label>
							<button
								onClick={() => {
									setDelay(0);
									setSyncOpen(false);
								}}
							>
								Back to live
							</button>
						</div>
					)}
				</div>
			</div>
			<div className="live-weather">
				{[
					["AIR", weather?.AirTemp, "°C", "#3892ff"],
					["TRACK", weather?.TrackTemp, "°C", "#fa951f"],
					["HUM", weather?.Humidity, "%", "#00c7db"],
					["WIND", weather?.WindSpeed, "m/s", "#8398af"],
					["PRESS", weather?.Pressure, "hPa", "#ad75fa"],
					[
						"RAIN",
						weather?.Rainfall == null
							? undefined
							: weather.Rainfall === "1"
								? "Yes"
								: weather.Rainfall === "0"
									? "No"
									: undefined,
						"",
						"#c3cdda",
					],
				].map(([label, value, unit, color]) => (
					<div key={label}>
						<span style={{ color }}>
							<Icon
								name={
									label === "AIR" || label === "TRACK"
										? "thermometer"
										: label === "HUM"
											? "drop"
											: label === "WIND"
												? "wind"
												: label === "PRESS"
													? "pressure"
													: "weather"
								}
								size={15}
							/>
						</span>
						<p>
							<small>{label}</small>
							<strong>
								{value ?? "—"}
								<em>{unit}</em>
							</strong>
						</p>
					</div>
				))}
			</div>
		</div>
	);
}

function TimingTable() {
	const data = useDataStore((state) => state.state);
	const prefs = useLivePreferences();
	const [tab, setTab] = useState("timing");
	const [expanded, setExpanded] = useState(false);
	const drivers = Object.values(data?.TimingData?.Lines ?? {})
		.filter((driver) => data?.DriverList?.[driver.RacingNumber])
		.sort((a, b) => Number(a.Position) - Number(b.Position));
	const maxLaps = getStintLapScale(
		data?.SessionInfo?.Type,
		data?.SessionInfo?.Name,
		data?.LapCount?.TotalLaps,
		drivers.map((driver) => driver.NumberOfLaps ?? 0),
	);
	const race =
		/^(race|sprint|sprint race)$/i.test(data?.SessionInfo?.Type ?? "") ||
		/^(race|sprint|sprint race)$/i.test(data?.SessionInfo?.Name ?? "");
	const columnWidths =
		tab === "timing" ? [40, 90, 66, 66, 72, 72, 244, 40, 58, 54, undefined] : [40, 90, 66, 66, 40, 58, 54, undefined];
	return (
		<Panel
			title="Leaderboard"
			icon="leaderboard"
			className={clsx("live-leaderboard", { "live-expanded": expanded })}
			actions={
				<>
					<div className="live-segment">
						<button aria-pressed={tab === "timing"} onClick={() => setTab("timing")}>
							Timing
						</button>
						<button aria-pressed={tab === "stints"} onClick={() => setTab("stints")}>
							Stints
						</button>
					</div>
					<div className="live-panel-tools">
						<button
							aria-label="Default density"
							title="Default density"
							aria-pressed={!prefs.compact}
							onClick={() => prefs.update({ compact: false })}
						>
							<Icon name="rows" size={14} />
						</button>
						<button
							aria-label="Compact density"
							title="Compact density"
							aria-pressed={prefs.compact}
							onClick={() => prefs.update({ compact: true })}
						>
							<Icon name="compact" size={14} />
						</button>
						<button
							aria-label={expanded ? "Restore leaderboard" : "Enlarge leaderboard"}
							onClick={() => setExpanded(!expanded)}
						>
							<Icon name={expanded ? "close" : "enlarge"} size={14} />
						</button>
					</div>
				</>
			}
		>
			<div className="live-table-scroll">
				<table className={clsx("live-table", { "live-stints-table": tab === "stints" })}>
					<colgroup>
						{columnWidths.map((width, index) => (
							<col key={index} style={{ width }} />
						))}
					</colgroup>
					<thead>
						<tr>
							<th className="live-align-center">POS</th>
							<th className="live-align-left">DRIVER</th>
							<th className="live-align-number">GAP</th>
							<th className="live-align-number">INT</th>
							{tab === "timing" ? (
								<>
									<th className="live-align-number">LAST</th>
									<th className="live-align-number">BEST</th>
									<th className="live-sectors-heading">
										MINI-SECTORS <Icon name="help" size={11} />
									</th>
									<th className="live-align-center">LAPS</th>
									<th className="live-align-center">PIT</th>
									<th className="live-align-center">TYRE</th>
									<th className="live-stint-history-heading">
										STINT HISTORY
										<StintAxis maxLaps={maxLaps} race={race} />
									</th>
								</>
							) : (
								<>
									<th className="live-align-center">LAPS</th>
									<th className="live-align-center">PIT</th>
									<th className="live-align-center">TYRE</th>
									<th className="live-stint-history-heading">
										STINT HISTORY
										<StintAxis maxLaps={maxLaps} race={race} />
									</th>
								</>
							)}
						</tr>
					</thead>
					<tbody>
						{drivers.map((timing, index) => {
							const driver = data!.DriverList![timing.RacingNumber];
							const stints = data?.TimingAppData?.Lines[driver.RacingNumber]?.Stints;
							const fastest = data?.TimingStats?.Lines[driver.RacingNumber]?.PersonalBestLapTime?.Position === 1;
							const retired = timing.Retired || timing.Stopped || timing.KnockedOut;
							const validGap = canShowQualifyingGap(timing);
							const deletedLast = isLastLapDeleted(timing, data?.RaceControlMessages?.Messages);
							const previous = drivers[index - 1];
							const firstOut = retired && !(previous?.Retired || previous?.Stopped || previous?.KnockedOut);
							const currentStats = timing.Stats?.[Math.max(0, (data?.TimingData?.SessionPart ?? 1) - 1)];
							const stats =
								currentStats?.TimeDiffToFastest || currentStats?.TimeDifftoPositionAhead
									? currentStats
									: retired
										? timing.Stats?.slice()
												.reverse()
												.find((part) => part.TimeDiffToFastest || part.TimeDifftoPositionAhead)
										: currentStats;
							const pit = timing.InPit ? (
								<span className="live-pit">IN PIT</span>
							) : timing.PitOut ? (
								<span className="live-pit">OUT</span>
							) : (
								(timing.NumberOfPitStops ?? "—")
							);
							return (
								<Fragment key={driver.RacingNumber}>
									{firstOut && (
										<tr className="live-out-divider">
											<td colSpan={columnWidths.length}>
												<span>OUT</span>
											</td>
										</tr>
									)}
									<tr
										key={driver.RacingNumber}
										className={clsx({ selected: prefs.selected.includes(driver.RacingNumber), retired })}
										onClick={() => prefs.select(driver.RacingNumber)}
										aria-selected={prefs.selected.includes(driver.RacingNumber)}
									>
										<td>{timing.Position || index + 1}</td>
										<td>
											<button className="live-driver-button" aria-label={"Select " + driver.FullName}>
												<TeamMark driver={driver} />
												<b>{driver.Tla}</b>
											</button>
										</td>
										<td className="live-muted">
											{timing.Retired ? (
												<span className="live-dnf">DNF</span>
											) : race ? (
												timing.GapToLeader || "—"
											) : validGap ? (
												stats?.TimeDiffToFastest || timing.TimeDiffToFastest || "—"
											) : (
												"—"
											)}
										</td>
										<td className="live-muted">
											{race
												? timing.IntervalToPositionAhead?.Value || "—"
												: validGap
													? stats?.TimeDifftoPositionAhead || timing.TimeDiffToPositionAhead || "—"
													: "—"}
										</td>
										{tab === "timing" ? (
											<>
												<td
													className={
														timing.LastLapTime?.OverallFastest
															? "live-purple"
															: timing.LastLapTime?.PersonalFastest
																? "live-green"
																: ""
													}
												>
													{deletedLast ? (
														<span
															className="live-deleted-lap"
															title="This lap time was deleted by Race Control"
															aria-label={`Deleted lap time ${timing.LastLapTime.Value}`}
														>
															<s>{timing.LastLapTime.Value}</s>
														</span>
													) : (
														timing.LastLapTime?.Value || "—"
													)}
												</td>
												<td className={fastest ? "live-purple" : ""}>{timing.BestLapTime?.Value || "—"}</td>
												<td>
													<MiniSectors
														timing={timing}
														bestSectors={data?.TimingStats?.Lines[driver.RacingNumber]?.BestSectors}
													/>
												</td>
												<td>{timing.NumberOfLaps ?? "—"}</td>
												<td className="live-muted">{pit}</td>
												<td>
													<Tyre stint={stints?.at(-1)} />
												</td>
												<td className="live-stint-history-cell">
													<StintTimeline stints={stints} maxLaps={maxLaps} />
												</td>
											</>
										) : (
											<>
												<td>{timing.NumberOfLaps ?? "—"}</td>
												<td className="live-muted">{pit}</td>
												<td>
													<Tyre stint={stints?.at(-1)} />
												</td>
												<td className="live-stint-history-cell">
													<StintTimeline stints={stints} maxLaps={maxLaps} />
												</td>
											</>
										)}
									</tr>
								</Fragment>
							);
						})}
					</tbody>
				</table>
				{!drivers.length && (
					<div className="live-empty">
						<Icon name="live" size={28} />
						<b>Connecting to the session</b>
						<p>Waiting for real timing data…</p>
					</div>
				)}
			</div>
		</Panel>
	);
}
function TeamMark({ driver }: { driver: Driver }) {
	const reference = useReferenceContext();
	if (reference?.logos[driver.RacingNumber])
		return (
			<span
				className="live-team-mark"
				style={{
					backgroundImage: `url(${reference.logos[driver.RacingNumber].replace("https://cdn.formula1dashboard.com/", "https://cdn.formula1dashboard.com/i/v1/w40-h24-fcontain-q85/")})`,
				}}
			/>
		);
	const slug: Record<string, string> = {
		Mercedes: "mercedes",
		Ferrari: "ferrari",
		McLaren: "mclaren",
		"Red Bull Racing": "red-bull-racing",
		Alpine: "alpine",
		Williams: "williams",
		"Aston Martin": "aston-martin",
		"Haas F1 Team": "haas-f1-team",
		"Racing Bulls": "racing-bulls",
	};
	return slug[driver.TeamName] ? (
		<span className="live-team-mark" style={{ backgroundImage: `url(/team-logos/${slug[driver.TeamName]}.svg)` }} />
	) : (
		<span className="live-team-fallback" style={{ color: "#" + driver.TeamColour }}>
			{driver.TeamName.slice(0, 1)}
		</span>
	);
}
function Tyre({ stint }: { stint?: Stint }) {
	const compound = stint?.Compound?.toLowerCase() || "unknown";
	return (
		<span className={"live-tyre live-tyre-" + compound} title={stint?.Compound || "Unknown compound"}>
			<span
				className="live-tyre-icon"
				role="img"
				aria-label={stint?.Compound || "Unknown tyre"}
				style={{ backgroundImage: `url(/tires/${compound}.svg)` }}
			/>
			<small>{stint?.TotalLaps ?? "—"}</small>
		</span>
	);
}
function MiniSectors({
	timing,
	bestSectors,
}: {
	timing: TimingDataDriver;
	bestSectors?: { Value: string; Position: number }[];
}) {
	return (
		<div className="live-mini-sectors">
			{(timing.Sectors ?? []).map((sector, index) => (
				<div key={index}>
					<div>
						{(sector.Segments ?? []).map((segment, i) => (
							<i key={i} className={"live-mini-status-" + segment.Status} />
						))}
					</div>
					<small
						className={sector.OverallFastest ? "live-purple" : sector.PersonalFastest ? "live-green" : "live-yellow"}
					>
						{sector.Value || "—"}
						<em className={bestSectors?.[index]?.Position === 1 ? "live-purple" : "live-muted"}>
							{bestSectors?.[index]?.Value || "—"}
						</em>
					</small>
				</div>
			))}
		</div>
	);
}

function TrackPanel() {
	const prefs = useLivePreferences();
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [positionStatus, setPositionStatus] = useState(getPositionFeedStatus);
	useEffect(() => {
		const timer = setInterval(() => setPositionStatus(getPositionFeedStatus()), 1000);
		return () => clearInterval(timer);
	}, []);
	const views: [CameraView, string, string][] = [
		["global", "Global", "globe"],
		["top", "Top-down", "top"],
		["heli", "Helicopter", "helicopter"],
		["chase", "Chase", "chase"],
		["onboard", "Onboard", "onboard"],
	];
	return (
		<Panel
			title="Track Map"
			icon="map"
			className="live-track-panel"
			actions={
				<div className="live-map-actions">
					<small>Mode</small>
					<div className="live-segment">
						<button aria-pressed={prefs.mode === "3d"} onClick={() => prefs.update({ mode: "3d" })}>
							3D
						</button>
						<button aria-pressed={prefs.mode === "2d"} onClick={() => prefs.update({ mode: "2d" })}>
							2D
						</button>
					</div>
					{prefs.mode === "3d" && (
						<>
							<small>View</small>
							<div className="live-segment">
								{views.map(([value, label, symbol]) => (
									<button
										key={value}
										aria-label={label + " view"}
										title={
											prefs.selected.length || ["global", "top"].includes(value)
												? label
												: "Select a driver in the leaderboard"
										}
										disabled={!prefs.selected.length && ["heli", "chase", "onboard"].includes(value)}
										aria-pressed={prefs.camera === value}
										onClick={() => prefs.update({ camera: value })}
									>
										<Icon name={symbol} size={15} />
									</button>
								))}
							</div>
						</>
					)}
					<button aria-label="Open track map settings" onClick={() => setSettingsOpen(!settingsOpen)}>
						<Icon name="sliders" size={15} />
					</button>
				</div>
			}
		>
			<div className="live-map-viewport">
				{prefs.mode === "3d" ? (
					<TrackScene
						settings={{
							labels: prefs.labels,
							corners: prefs.corners,
							shadows: prefs.shadows,
							lighting: prefs.lighting,
							zoom: prefs.zoom,
							view: prefs.camera,
							driver: prefs.selected.at(-1) || null,
						}}
					/>
				) : (
					<div
						className={clsx("live-map-2d", { "hide-labels": !prefs.labels })}
						style={{ transform: `scale(${prefs.zoom})` }}
					>
						<Map />
					</div>
				)}
				<div className="live-zoom-controls">
					<button aria-label="Zoom in" onClick={() => prefs.update({ zoom: Math.min(8, prefs.zoom * 1.25) })}>
						+
					</button>
					<button aria-label="Reset zoom" onClick={() => prefs.update({ zoom: 1, camera: "global" })}>
						⌖
					</button>
					<button aria-label="Zoom out" onClick={() => prefs.update({ zoom: Math.max(0.4, prefs.zoom / 1.25) })}>
						−
					</button>
				</div>
				<span className={clsx("live-map-source", { "live-source-stale": positionStatus.stale })}>
					<i />
					{positionStatus.available
						? positionStatus.stale
							? `Positions paused${positionStatus.lastTimestamp !== null ? " · " + new Date(positionStatus.lastTimestamp).toLocaleTimeString("en-GB") : ""}`
							: "Live positions · 2s buffer"
						: "Positions estimated from mini-sectors"}
				</span>
				{settingsOpen && (
					<div className="live-map-settings">
						<strong>
							Track map settings
							<button aria-label="Close map settings" onClick={() => setSettingsOpen(false)}>
								<Icon name="close" size={14} />
							</button>
						</strong>
						{[
							["labels", "Driver codes", prefs.labels],
							["corners", "Corner numbers", prefs.corners],
							["shadows", "3D buildings", prefs.shadows],
						].map(([key, label, value]) => (
							<label key={String(key)}>
								{label}
								<input
									type="checkbox"
									checked={Boolean(value)}
									onChange={(e) => {
										prefs.update({ [String(key)]: e.target.checked });
										if (key === "corners") useSettingsStore.getState().setShowCornerNumbers(e.target.checked);
									}}
								/>
							</label>
						))}
						<label>
							Lighting
							<select
								aria-label="Map lighting"
								value={prefs.lighting}
								onChange={(e) =>
									prefs.update({ lighting: e.target.value as "realtime" | "day" | "sunrise" | "sunset" | "night" })
								}
							>
								<option value="realtime">Real time</option>
								<option value="day">Day</option>
								<option value="sunrise">Sunrise</option>
								<option value="sunset">Sunset</option>
								<option value="night">Night</option>
							</select>
						</label>
					</div>
				)}
			</div>
		</Panel>
	);
}
function BenchmarksPanel() {
	const data = useDataStore((state) => state.state);
	const reference = useReferenceContext();
	const best = Object.values(data?.TimingData?.Lines ?? {})
		.filter((driver) => driver.BestLapTime?.Value)
		.sort((a, b) => lapSeconds(a.BestLapTime.Value) - lapSeconds(b.BestLapTime.Value))[0];
	const seconds = best ? lapSeconds(best.BestLapTime.Value) : null;
	const previousTitle =
		data?.SessionInfo?.Type === "Practice"
			? `PREVIOUS ${data.SessionInfo.Name.toUpperCase()} EDITION`
			: "PREVIOUS EDITION";
	return (
		<Panel
			title="Best Lap Benchmarks"
			icon="clock"
			actions={
				<button
					aria-label="Best lap benchmarks explanation"
					title="Previous Edition: fastest lap in this session at the previous edition. Lap Record: fastest Grand Prix race lap. Track Record: fastest official lap across all sessions."
				>
					<Icon name="help" size={15} />
				</button>
			}
		>
			<div className="live-benchmarks">
				<div className="live-session-best">
					<small>SESSION BEST</small>
					<div>
						<strong>{best?.BestLapTime.Value || "—"}</strong>
						<span>
							{best && data?.DriverList?.[best.RacingNumber] && (
								<TeamMark driver={data.DriverList[best.RacingNumber]} />
							)}
							{best && data?.DriverList?.[best.RacingNumber]?.Tla}
						</span>
					</div>
				</div>
				{[
					[previousTitle, reference?.previous],
					["LAP RECORD", reference?.lapRecord],
					["TRACK RECORD", reference?.trackRecord],
				].map(([title, raw]) => {
					const record = raw as import("@/types/live-context.type").BenchmarkRecord | null;
					const delta = record && seconds !== null ? seconds - record.seconds : null;
					return (
						<div className="live-record-card" key={String(title)}>
							<small>{String(title)}</small>
							<div>
								<b>{record?.time || (reference ? "Not available" : "Loading…")}</b>
								{delta !== null && (
									<span className={clsx("live-lap-delta", delta < 0 ? "faster" : "slower")}>
										{delta >= 0 ? "+" : ""}
										{delta.toFixed(3)}s
									</span>
								)}
							</div>
							{record && (
								<p>
									{record.driver_name}, {record.year}
								</p>
							)}
						</div>
					);
				})}
			</div>
		</Panel>
	);
}
function lapSeconds(time: string) {
	const parts = time.split(":").map(Number);
	return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
}

const pedalPercent = (value: number | undefined) => (value !== undefined && value >= 0 && value <= 100 ? value : null);
function TelemetryPanel() {
	const selected = useLivePreferences((s) => s.selected);
	const data = useDataStore((s) => s.state);
	const cars = useDataStore((s) => s.carsData);
	const [history, setHistory] = useState<Record<string, number[]>>({});
	useEffect(
		() =>
			useDataStore.subscribe((state, previous) => {
				if (state.carsData === previous.carsData) return;
				setHistory((old) =>
					Object.fromEntries(
						selected.map((number) => [
							number,
							[...(old[number] ?? []).slice(-79), state.carsData?.[number]?.Channels[2] ?? 0],
						]),
					),
				);
			}),
		[selected],
	);
	return (
		<Panel title="Telemetry" icon="gauge">
			<div className="live-telemetry">
				{!selected.length ? (
					<div className="live-empty">
						<Icon name="gauge" size={28} />
						<b>No Drivers Selected</b>
						<p>
							Select up to 2 drivers from
							<br />
							the leaderboard
						</p>
					</div>
				) : (
					<>
						{selected.map((number) => {
							const driver = data?.DriverList?.[number];
							const channels = cars?.[number]?.Channels;
							return (
								<div key={number} className="live-telemetry-driver" style={{ borderColor: "#" + driver?.TeamColour }}>
									<div>
										<b style={{ color: "#" + driver?.TeamColour }}>{driver?.Tla || number}</b>
										<strong>
											{channels?.[2] ?? "—"}
											<small>km/h</small>
										</strong>
										<span>{channels?.[3] === 0 ? "N" : (channels?.[3] ?? "—")}</span>
									</div>
									<label>
										<span>THROTTLE</span>
										<meter min="0" max="100" value={pedalPercent(channels?.[4]) ?? 0} />
										<em>{pedalPercent(channels?.[4]) !== null ? pedalPercent(channels?.[4]) + "%" : "—"}</em>
									</label>
									<label>
										<span>BRAKE</span>
										<meter min="0" max="100" value={pedalPercent(channels?.[5]) ?? 0} />
										<em>{pedalPercent(channels?.[5]) !== null ? pedalPercent(channels?.[5]) + "%" : "—"}</em>
									</label>
								</div>
							);
						})}
						<svg
							className="live-speed-chart"
							viewBox="0 0 320 75"
							preserveAspectRatio="none"
							aria-label="Live speed history"
						>
							<path d="M0 25H320M0 50H320" stroke="var(--live-border)" />
							{selected.map((number) => (
								<polyline
									key={number}
									fill="none"
									stroke={"#" + (data?.DriverList?.[number]?.TeamColour || "ffffff")}
									strokeWidth="2"
									points={(history[number] ?? [])
										.map(
											(speed, i, values) =>
												`${(i / Math.max(1, values.length - 1)) * 320},${75 - (Math.min(360, speed) / 360) * 75}`,
										)
										.join(" ")}
								/>
							))}
						</svg>
					</>
				)}
			</div>
		</Panel>
	);
}
