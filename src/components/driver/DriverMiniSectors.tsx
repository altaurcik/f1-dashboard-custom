import clsx from "clsx";

import type { TimingDataDriver, TimingStatsDriver } from "@/types/state.type";
import { useSettingsStore } from "@/stores/useSettingsStore";

type Props = {
	sectors: TimingDataDriver["Sectors"];
	bestSectors: TimingStatsDriver["BestSectors"] | undefined;
	forceCompact?: boolean;
};

export default function DriverMiniSectors({ sectors = [], bestSectors, forceCompact = false }: Props) {
	const showMiniSectors = useSettingsStore((state) => state.showMiniSectors);
	const showBestSectors = useSettingsStore((state) => state.showBestSectors);

	return (
		<div className={clsx("flex", forceCompact ? "gap-1" : "gap-2")}>
			{sectors.map((sector, i) => (
				<div key={`sector.${i}`} className={clsx("flex flex-col", forceCompact ? "gap-0.5" : "gap-1")}>
					{showMiniSectors && (
						<div className={clsx("flex flex-row", forceCompact ? "gap-px" : "gap-1")}>
							{sector.Segments.map((segment, j) => (
								<MiniSector status={segment.Status} compact={forceCompact} key={`sector.mini.${j}`} />
							))}
						</div>
					)}

					<div className={clsx("flex", showMiniSectors ? "items-center gap-1" : "flex-col")}>
						<p
							className={clsx(forceCompact ? "text-sm" : "text-lg", "leading-none font-medium tabular-nums", {
								"text-violet-600!": sector.OverallFastest,
								"text-emerald-500!": sector.PersonalFastest,
								"text-zinc-500": !sector.Value,
							})}
						>
							{!!sector.Value ? sector.Value : !!sector.PreviousValue ? sector.PreviousValue : "-- ---"}
						</p>

						{showBestSectors && (
							<p
								className={clsx(forceCompact ? "text-xs" : "text-sm", "leading-none text-zinc-500 tabular-nums", {
									"text-violet-600!": bestSectors?.[i].Position === 1,
								})}
							>
								{bestSectors && bestSectors[i].Value ? bestSectors[i].Value : "-- ---"}
							</p>
						)}
					</div>
				</div>
			))}
		</div>
	);
}

function MiniSector({ status, compact }: { status: number; compact: boolean }) {
	return (
		<div
			style={{ width: compact ? 5 : 10, height: compact ? 3 : 5, borderRadius: compact ? 1 : 2 }}
			className={clsx({
				"bg-amber-400": status === 2048 || status === 2052, // TODO unsure
				"bg-emerald-500": status === 2049,
				"bg-violet-600": status === 2051,
				"bg-blue-500": status === 2064,
				"bg-zinc-700": status === 0,
			})}
		/>
	);
}
