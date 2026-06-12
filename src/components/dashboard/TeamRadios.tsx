import { AnimatePresence } from "motion/react";
import clsx from "clsx";

import { useDataStore } from "@/stores/useDataStore";

import { sortUtc } from "@/lib/sorting";

import RadioMessage from "@/components/dashboard/RadioMessage";

export default function TeamRadios() {
	const drivers = useDataStore((state) => state.state?.DriverList);
	const teamRadios = useDataStore((state) => state.state?.TeamRadio);
	const sessionPath = useDataStore((state) => state.state?.SessionInfo?.Path);

	const gmtOffset = useDataStore((state) => state.state?.SessionInfo?.GmtOffset);

	const basePath = `https://livetiming.formula1.com/static/${sessionPath}`;

	return (
		<ul className="flex flex-col gap-1">
			{!teamRadios && new Array(5).fill("").map((_, index) => <SkeletonMessage key={`radio.loading.${index}`} />)}

			{teamRadios && gmtOffset && drivers && teamRadios.Captures && (
				<AnimatePresence>
					{teamRadios.Captures.sort(sortUtc)
						.slice(0, 5)
						.map((teamRadio, i) => (
							<RadioMessage
								key={`radio.${i}`}
								driver={drivers[teamRadio.RacingNumber]}
								capture={teamRadio}
								basePath={basePath}
								gmtOffset={gmtOffset}
							/>
						))}
				</AnimatePresence>
			)}
		</ul>
	);
}

const SkeletonMessage = () => {
	const animateClass = "h-6 animate-pulse rounded-md bg-zinc-800";

	return (
		<li className="flex flex-col gap-0.5 p-1.5">
			<div className={clsx(animateClass, "h-3! w-14")} />

			<div
				className="grid place-items-center items-center gap-2"
				style={{
					gridTemplateColumns: "2rem minmax(0, 1fr)",
				}}
			>
				<div className="place-self-start">
					<div className={clsx(animateClass, "h-6! w-10")} />
				</div>

				<div className="flex w-full items-center gap-2">
					<div className={clsx(animateClass, "h-5! w-5")} />
					<div className={clsx(animateClass, "h-3! flex-1")} />
				</div>
			</div>
		</li>
	);
};
