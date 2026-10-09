"use client";
import { type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useDataStore } from "@/stores/useDataStore";
import SessionInfo from "@/components/SessionInfo";
import WeatherInfo from "@/components/WeatherInfo";
import TrackInfo from "@/components/TrackInfo";
import DelayInput from "@/components/DelayInput";
import DelayTimer from "@/components/DelayTimer";
import ConnectionStatus from "@/components/ConnectionStatus";
export default function LegacyDashboardChrome({
	children,
	connected,
	maxDelay,
}: {
	children: ReactNode;
	connected: boolean;
	maxDelay: number;
}) {
	const delay = useSettingsStore((state) => state.delay);
	const syncing = delay > maxDelay;
	const ended = useDataStore(({ state }) => state?.SessionStatus?.Status === "Ends");
	return (
		<div className="flex h-screen w-full overflow-hidden p-2">
			<motion.div layout="size" className="flex h-full w-full flex-1 flex-col md:gap-2">
				<DesktopStaticBar show={!syncing || ended} />
				<MobileStaticBar show={!syncing || ended} connected={connected} />

				<div className={!syncing || ended ? "min-h-0 w-full flex-1 overflow-hidden md:rounded-lg" : "hidden"}>
					<MobileDynamicBar />
					{children}
				</div>

				<div
					className={
						syncing && !ended
							? "flex h-full flex-1 flex-col items-center justify-center gap-2 border-zinc-800 md:rounded-lg md:border"
							: "hidden"
					}
				>
					<h1 className="my-20 text-center text-5xl font-bold">Syncing...</h1>
					<p>Please wait for {delay - maxDelay} seconds.</p>
					<p>Or make your delay smaller.</p>
				</div>
			</motion.div>
		</div>
	);
}
function MobileDynamicBar() {
	return (
		<div className="flex flex-col divide-y divide-zinc-800 border-b border-zinc-800 md:hidden">
			<div className="p-2">
				<SessionInfo />
			</div>
			<div className="p-2">
				<WeatherInfo />
			</div>
		</div>
	);
}

function MobileStaticBar({ show, connected }: { show: boolean; connected: boolean }) {
	return (
		<div className="flex w-full items-center justify-between overflow-hidden border-b border-zinc-800 p-2 md:hidden">
			<div className="flex items-center gap-2">
				<DelayInput saveDelay={500} />
				<DelayTimer />

				<ConnectionStatus connected={connected} />
			</div>

			{show && <TrackInfo />}
		</div>
	);
}

function DesktopStaticBar({ show }: { show: boolean }) {
	return (
		<div className="hidden w-full flex-row justify-between overflow-hidden rounded-lg border border-zinc-800 p-2 md:flex">
			<div className="flex items-center gap-2">
				<AnimatePresence>
					<motion.div key="session-info" layout="position">
						<SessionInfo />
					</motion.div>
				</AnimatePresence>
			</div>

			<div className="hidden md:items-center lg:flex">{show && <WeatherInfo />}</div>

			<div className="flex justify-end">{show && <TrackInfo />}</div>
		</div>
	);
}
