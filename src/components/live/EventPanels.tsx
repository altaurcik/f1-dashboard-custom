"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRadioTranscript } from "@/hooks/useRadioTranscript";
import Icon from "./Icon";
import { useDataStore } from "@/stores/useDataStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useLivePreferences } from "@/stores/useLivePreferences";
import { useReferenceContext } from "./ReferenceContext";
import type { Message, RadioCapture, Driver } from "@/types/state.type";

export function eventStyle(message: Message) {
	if (message.Flag === "YELLOW" || message.Flag === "DOUBLE YELLOW")
		return {
			name: `${message.Flag === "DOUBLE YELLOW" ? "Double Yellow" : "Yellow"}${message.Sector ? ` (Sec. ${message.Sector})` : ""}`,
			tone: "yellow",
			icon: "flag",
		};
	if (message.Flag === "RED") return { name: "Red flag", tone: "red", icon: "flag" };
	if (["CLEAR", "GREEN"].includes(message.Flag || "") || /GREEN LIGHT|PIT EXIT OPEN/i.test(message.Message))
		return { name: `Green${message.Sector ? ` (Sec. ${message.Sector})` : ""}`, tone: "green", icon: "flag" };
	if (message.Flag === "BLUE") return { name: "Blue flag", tone: "blue", icon: "flag" };
	if (/\bPENALTY\b/i.test(message.Message)) return { name: "Penalty", tone: "red", icon: "penalty" };
	if (/TRACK LIMIT|TIME.*DELETED|LAP DELETED/i.test(message.Message))
		return { name: "Track Limits", tone: "orange", icon: "limits" };
	if (/SAFETY CAR|VSC/i.test(message.Message))
		return {
			name: /VSC|VIRTUAL/i.test(message.Message) ? "Virtual Safety Car" : "Safety Car",
			tone: "orange",
			icon: "car",
		};
	if (/\b(?:INCIDENT|NOTED|INVESTIGAT\w*)\b/i.test(message.Message))
		return { name: "Investigation", tone: "purple", icon: "investigation" };
	return { name: message.Category === "Other" ? "Info" : message.Category, tone: "neutral", icon: "info" };
}
const formatEventText = (value: string) =>
	value === value.toUpperCase()
		? value
				.toLowerCase()
				.replace(/(^| - )([a-z])/g, (part) => part.toUpperCase())
				.replace(/\(([a-z]{2,4})\)/g, (part) => part.toUpperCase())
				.replace(/\b(f1|fia|vsc|drs|sc|sq[1-3]|q[1-3])\b/gi, (part) => part.toUpperCase())
		: value;
const eventKey = (message: Message) => message.Utc + ":" + message.Message;
const timeLabel = (utc: string) =>
	new Date(utc.endsWith("Z") ? utc : utc + "Z").toLocaleTimeString("en-GB", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});

export function EventNotifications() {
	const [toasts, setToasts] = useState<Message[]>([]);
	useEffect(() => {
		const current = useDataStore.getState().state;
		const history = current?.RaceControlMessages?.Messages;
		let seen = new Set((history ?? []).map(eventKey));
		let session = current?.SessionInfo?.Path || "";
		let initialized = !!history;
		const timers = new Set<ReturnType<typeof setTimeout>>();
		const audio = new Audio("/sounds/chime.mp3");
		const unsubscribe = useDataStore.subscribe((data) => {
			const messages = data.state?.RaceControlMessages?.Messages;
			if (!messages) return;
			const nextSession = data.state?.SessionInfo?.Path || "";
			if (!initialized || nextSession !== session) {
				timers.forEach(clearTimeout);
				timers.clear();
				setToasts([]);
				seen = new Set(messages.map(eventKey));
				initialized = true;
				session = nextSession;
				return;
			}
			const next = messages.filter((message) => !seen.has(eventKey(message)));
			next.forEach((message) => seen.add(eventKey(message)));
			if (!useLivePreferences.getState().notifications || !next.length) return;
			setToasts((old) => [...next.reverse(), ...old].slice(0, 4));
			if (useSettingsStore.getState().raceControlChime) {
				audio.volume = useSettingsStore.getState().raceControlChimeVolume / 100;
				void audio.play().catch(() => {});
			}
			for (const message of next) {
				if (
					useLivePreferences.getState().desktopNotifications &&
					typeof Notification !== "undefined" &&
					Notification.permission === "granted"
				) {
					const category = eventStyle(message);
					new Notification(category.name, {
						body: formatEventText(message.Message),
						icon: "/icon.png",
						tag: eventKey(message),
					});
				}
				const timer = setTimeout(() => {
					setToasts((old) => old.filter((item) => eventKey(item) !== eventKey(message)));
					timers.delete(timer);
				}, 9000);
				timers.add(timer);
			}
		});
		return () => {
			unsubscribe();
			timers.forEach(clearTimeout);
			audio.pause();
		};
	}, []);
	return (
		<div className="live-event-toasts" aria-live="polite">
			{toasts.map((message) => {
				const style = eventStyle(message);
				return (
					<article key={eventKey(message)} className={"live-event-toast event-" + style.tone}>
						<header>
							<Icon name={style.icon} />
							<b>{style.name}</b>
							<time>{timeLabel(message.Utc)}</time>
							<button
								aria-label="Dismiss event notification"
								onClick={() => setToasts((old) => old.filter((item) => eventKey(item) !== eventKey(message)))}
							>
								<Icon name="close" size={14} />
							</button>
						</header>
						<p>{formatEventText(message.Message)}</p>
					</article>
				);
			})}
		</div>
	);
}

export function RaceEventsPanel() {
	const messages = useDataStore((state) => state.state?.RaceControlMessages?.Messages);
	const preferences = useLivePreferences();
	const sound = useSettingsStore((state) => state.raceControlChime);
	const toggleSound = useSettingsStore((state) => state.setRaceControlChime);
	const [filtersOpen, setFiltersOpen] = useState(false);
	const [filter, setFilter] = useState("all");
	const ordered = [...(messages || [])].sort((a, b) => Date.parse(b.Utc) - Date.parse(a.Utc));
	return (
		<section className="live-panel live-messages-panel">
			<header className="live-panel-header">
				<h2>
					<Icon name="megaphone" />
					Race Control
				</h2>
				<div className="live-event-tools">
					<button
						aria-label={preferences.notifications ? "Disable event notifications" : "Enable event notifications"}
						aria-pressed={preferences.notifications}
						title="Event notifications"
						onClick={() => preferences.update({ notifications: !preferences.notifications })}
					>
						<Icon name={preferences.notifications ? "bell" : "bell-off"} size={15} />
					</button>
					<button
						aria-label={sound ? "Mute event sounds" : "Enable event sounds"}
						aria-pressed={sound}
						title="Notification sound"
						onClick={() => toggleSound(!sound)}
					>
						<Icon name="volume" size={15} />
					</button>
					<button aria-label="Show event filters" onClick={() => setFiltersOpen(!filtersOpen)}>
						<Icon name="filter" size={15} />
					</button>
					<span className="live-count">{messages?.length ?? 0}</span>
				</div>
			</header>
			{filtersOpen && (
				<div className="live-event-filters">
					{[
						["all", "All"],
						["flags", "Flags"],
						["limits", "Track limits"],
					].map(([value, label]) => (
						<button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
							{label}
						</button>
					))}
					<label className="live-notification-setting">
						Desktop notifications
						<input
							type="checkbox"
							checked={preferences.desktopNotifications}
							onChange={async (event) => {
								if (!event.target.checked) {
									preferences.update({ desktopNotifications: false });
									return;
								}
								if (typeof Notification !== "undefined") {
									const permission = await Notification.requestPermission();
									preferences.update({ desktopNotifications: permission === "granted" });
								}
							}}
						/>
					</label>
					<label className="live-notification-setting">
						Notification sound
						<input type="checkbox" checked={sound} onChange={(e) => toggleSound(e.target.checked)} />
					</label>
				</div>
			)}
			<div className="live-panel-scroll">
				{ordered
					.filter(
						(message) =>
							filter === "all" || (filter === "flags" ? !!message.Flag : eventStyle(message).name === "Track Limits"),
					)
					.map((message) => {
						const style = eventStyle(message);
						return (
							<article className={"live-event-card event-" + style.tone} key={eventKey(message)}>
								<header>
									<Icon name={style.icon} size={16} />
									<b>{style.name}</b>
									<time>{timeLabel(message.Utc)}</time>
								</header>
								<p>{formatEventText(message.Message)}</p>
							</article>
						);
					})}
				{!ordered.length && <div className="live-empty">No race control messages yet.</div>}
			</div>
		</section>
	);
}

export function RadioPanel() {
	const captures = useDataStore((state) => state.state?.TeamRadio?.Captures);
	const drivers = useDataStore((state) => state.state?.DriverList);
	const session = useDataStore((state) => state.state?.SessionInfo?.Path);
	const reference = useReferenceContext();
	const ordered = [...(captures || [])].sort((a, b) => Date.parse(b.Utc) - Date.parse(a.Utc));
	return (
		<section className="live-panel live-messages-panel">
			<header className="live-panel-header">
				<h2>
					<Icon name="radio" />
					Team Radio
				</h2>
				<span className="live-count">{ordered.length}</span>
			</header>
			<div className="live-panel-scroll">
				{ordered.map((capture, index) => {
					const driver = drivers?.[capture.RacingNumber];
					if (!driver) return null;
					return (
						<RadioCard
							key={capture.Utc + capture.Path}
							capture={capture}
							driver={driver}
							portrait={reference?.portraits[capture.RacingNumber] || driver.HeadshotUrl}
							session={session || ""}
							automatic={index < 5 && !!session}
						/>
					);
				})}
				{!ordered.length && <div className="live-empty">No team radio messages yet.</div>}
			</div>
		</section>
	);
}
function RadioCard({
	capture,
	driver,
	portrait,
	session,
	automatic,
}: {
	capture: RadioCapture;
	driver: Driver;
	portrait?: string;
	session: string;
	automatic: boolean;
}) {
	const audioRef = useRef<HTMLAudioElement>(null);
	const [playing, setPlaying] = useState(false);
	const [error, setError] = useState("");
	const audioUrl = "https://livetiming.formula1.com/static/" + session + capture.Path;
	const transcript = useRadioTranscript(audioUrl, automatic);
	const toggle = async () => {
		if (!audioRef.current) return;
		if (playing) {
			audioRef.current.pause();
			setPlaying(false);
		} else {
			try {
				await audioRef.current.play();
				setPlaying(true);
				setError("");
			} catch {
				setError("Audio is temporarily unavailable.");
			}
		}
	};
	return (
		<article className="live-radio-card">
			<div
				className="live-radio-avatar"
				style={{ backgroundColor: "#" + driver.TeamColour + "22", borderColor: "#" + driver.TeamColour }}
			>
				{portrait ? (
					<Image
						unoptimized
						src={portrait.replace(
							"https://cdn.formula1dashboard.com/",
							"https://cdn.formula1dashboard.com/i/v1/w36-h36-fcover-q75/",
						)}
						alt={driver.FullName}
						width={36}
						height={42}
					/>
				) : (
					<span>{driver.Tla}</span>
				)}
			</div>
			<div className="live-radio-description">
				<b>{driver.LastName || driver.Tla}</b>
				<time>{timeLabel(capture.Utc)}</time>
				{error && <small>{error}</small>}
				<div
					className="live-radio-transcript"
					aria-live="polite"
					aria-busy={transcript.phase === "loading" || transcript.phase === "queued"}
				>
					{transcript.phase === "ready" ? (
						<p>{transcript.text}</p>
					) : transcript.phase === "loading" || transcript.phase === "queued" ? (
						<span>{transcript.text}</span>
					) : (
						<>
							{transcript.phase === "error" && <span role="status">{transcript.text}</span>}
							<button type="button" onClick={transcript.load} disabled={!session}>
								{transcript.phase === "error" ? "Retry transcript" : "Transcribe"}
							</button>
						</>
					)}
				</div>
			</div>
			<button
				className="live-radio-play"
				aria-label={(playing ? "Pause " : "Play ") + driver.LastName + " radio"}
				onClick={() => void toggle()}
			>
				<Icon name={playing ? "pause" : "play"} size={16} />
			</button>
			<audio ref={audioRef} preload="none" src={audioUrl} onEnded={() => setPlaying(false)} />
		</article>
	);
}
