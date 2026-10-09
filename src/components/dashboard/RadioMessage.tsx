import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { utc } from "moment";
import clsx from "clsx";

import type { Driver, RadioCapture } from "@/types/state.type";

import { useSettingsStore } from "@/stores/useSettingsStore";

import { toTrackTime } from "@/lib/toTrackTime";

import DriverTag from "@/components/driver/DriverTag";
import PlayControls from "@/components/ui/PlayControls";

type Props = {
	driver: Driver;
	capture: RadioCapture;
	basePath: string;
	gmtOffset: string;
	transcriptionAvailable: boolean | null;
};

let transcriptQueue = Promise.resolve();

function enqueueTranscript<T>(task: () => Promise<T>): Promise<T> {
	const result = transcriptQueue.then(task, task);
	transcriptQueue = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

export default function RadioMessage({ driver, capture, basePath, gmtOffset, transcriptionAvailable }: Props) {
	const audioRef = useRef<HTMLAudioElement | null>(null);

	const [playing, setPlaying] = useState<boolean>(false);
	const [transcript, setTranscript] = useState<string>("Queued for transcription...");
	const [transcriptError, setTranscriptError] = useState<string | null>(null);

	const audioUrl = `${basePath}${capture.Path}`;

	const onEnded = () => {
		setPlaying(false);
		resetPlayback();
	};

	const resetPlayback = () => {
		const audio = audioRef.current;
		if (!audio) return;

		if (typeof audio.fastSeek === "function") {
			audio.fastSeek(0);
			return;
		}

		audio.currentTime = 0;
	};

	const togglePlayback = () => {
		setPlaying((old) => {
			if (!audioRef.current) return old;

			if (!old) {
				audioRef.current.play();
			} else {
				audioRef.current.pause();

				setTimeout(() => {
					resetPlayback();
				}, 10000);
			}

			return !old;
		});
	};

	useEffect(() => {
		let cancelled = false;

		if (transcriptionAvailable !== true) return;

		enqueueTranscript(async () => {
			if (cancelled) return;

			setTranscript("Transcribing...");
			setTranscriptError(null);

			const response = await fetch("/api/radio-transcript", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ audioUrl }),
			});

			const data = (await response.json()) as { text?: string; error?: string; code?: string };

			if (data.code === "TRANSCRIPTION_UNAVAILABLE") {
				if (!cancelled) setTranscript("Transcript unavailable. Audio is available.");
				return;
			}

			if (!response.ok) {
				throw new Error(data.error ?? "Transcription failed.");
			}

			if (!cancelled) {
				setTranscript(data.text?.trim() || "No speech detected.");
			}
		}).catch((error: unknown) => {
			console.error(error);

			if (!cancelled) {
				const message = error instanceof Error ? error.message : "Transcript unavailable.";
				setTranscriptError(message.includes("HF_TOKEN") ? "HF_TOKEN required for speaker diarization." : message);
			}
		});

		return () => {
			cancelled = true;
		};
	}, [audioUrl, transcriptionAvailable]);

	const favoriteDriver = useSettingsStore((state) => state.favoriteDrivers.includes(driver.RacingNumber));

	const localTime = utc(capture.Utc).local().format("HH:mm:ss");
	const trackTime = utc(toTrackTime(capture.Utc, gmtOffset)).format("HH:mm");

	return (
		<motion.li
			animate={{ opacity: 1, scale: 1 }}
			initial={{ opacity: 0, scale: 0.9 }}
			className={clsx("flex flex-col gap-0.5 rounded-md p-1.5", { "bg-sky-800/30": favoriteDriver })}
		>
			<div className="flex items-center gap-1 text-[11px] leading-none text-zinc-500">
				<time dateTime={localTime}>{localTime}</time>
				{"·"}
				<time className="text-zinc-700" dateTime={trackTime}>
					{trackTime}
				</time>
			</div>

			<div className="flex items-start gap-1">
				<DriverTag
					className="!w-fit !rounded-md !px-0.5 !py-0.5 text-xs"
					teamColor={driver.TeamColour}
					short={driver.Tla}
				/>

				<PlayControls className="h-6! w-6! shrink-0" playing={playing} onClick={togglePlayback} />
				<p className="min-w-0 flex-1 text-[11px] leading-snug whitespace-pre-line text-zinc-300">
					{transcriptionAvailable === null
						? "Checking transcript availability..."
						: transcriptionAvailable === false
							? "Transcript unavailable. Audio is available."
							: (transcriptError ?? transcript)}
				</p>

				<audio preload="none" src={`${basePath}${capture.Path}`} ref={audioRef} onEnded={() => onEnded()} />
			</div>
		</motion.li>
	);
}
