import { useRef, useState } from "react";
import { motion } from "motion/react";
import { utc } from "moment";
import clsx from "clsx";

import { useRadioTranscript } from "@/hooks/useRadioTranscript";

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

export default function RadioMessage({ driver, capture, basePath, gmtOffset, transcriptionAvailable }: Props) {
	const audioRef = useRef<HTMLAudioElement | null>(null);

	const [playing, setPlaying] = useState<boolean>(false);

	const audioUrl = `${basePath}${capture.Path}`;
	const transcript = useRadioTranscript(audioUrl, transcriptionAvailable === true);

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
							: transcript.text || "Queued for local transcription…"}
				</p>

				<audio preload="none" src={`${basePath}${capture.Path}`} ref={audioRef} onEnded={() => onEnded()} />
			</div>
		</motion.li>
	);
}
