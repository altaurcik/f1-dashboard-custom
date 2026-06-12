"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import LeaderBoard from "@/components/dashboard/LeaderBoard";
import RaceControl from "@/components/dashboard/RaceControl";
import TeamRadios from "@/components/dashboard/TeamRadios";
import Map from "@/components/dashboard/Map";

export default function Page() {
	const gridRef = useRef<HTMLDivElement>(null);
	const leaderBoardViewportRef = useRef<HTMLDivElement>(null);
	const fullLeaderBoardMeasureRef = useRef<HTMLDivElement>(null);
	const [needsCompactSectors, setNeedsCompactSectors] = useState(false);
	const [leaderBoardScale, setLeaderBoardScale] = useState(1);

	const measureLeaderBoard = useCallback(() => {
		const grid = gridRef.current;
		const leaderBoardViewport = leaderBoardViewportRef.current;
		const fullLeaderBoardMeasure = fullLeaderBoardMeasureRef.current;

		if (!grid || !leaderBoardViewport || !fullLeaderBoardMeasure) {
			return;
		}

		const halfGridWidth = grid.clientWidth / 2;
		const fullLeaderBoardWidth = fullLeaderBoardMeasure.scrollWidth;
		const shouldCompactSectors = fullLeaderBoardWidth > halfGridWidth;
		const fullLeaderBoardHeight = fullLeaderBoardMeasure.scrollHeight;
		const availableLeaderBoardHeight = leaderBoardViewport.clientHeight;
		const nextLeaderBoardScale =
			fullLeaderBoardHeight > 0 && availableLeaderBoardHeight > 0
				? Math.min(1, availableLeaderBoardHeight / fullLeaderBoardHeight)
				: 1;

		setNeedsCompactSectors(shouldCompactSectors);
		setLeaderBoardScale(Number(nextLeaderBoardScale.toFixed(3)));
	}, []);

	useEffect(() => {
		measureLeaderBoard();

		const resizeObserver = new ResizeObserver(measureLeaderBoard);

		if (gridRef.current) {
			resizeObserver.observe(gridRef.current);
		}

		if (leaderBoardViewportRef.current) {
			resizeObserver.observe(leaderBoardViewportRef.current);
		}

		if (fullLeaderBoardMeasureRef.current) {
			resizeObserver.observe(fullLeaderBoardMeasureRef.current);
		}

		return () => resizeObserver.disconnect();
	}, [measureLeaderBoard]);

	return (
		<div
			ref={gridRef}
			className="relative grid h-full min-h-0 w-full gap-2 overflow-hidden"
			style={{
				gridTemplateColumns: "fit-content(50%) minmax(0, 1fr)",
			}}
		>
			<div
				ref={fullLeaderBoardMeasureRef}
				aria-hidden="true"
				className="pointer-events-none invisible fixed top-0 left-0 -z-10 w-max p-2"
			>
				<LeaderBoard />
			</div>

			<section className="min-h-0 overflow-hidden rounded-lg border border-zinc-800 p-2">
				<div ref={leaderBoardViewportRef} className="h-full min-h-0 overflow-hidden">
					<div
						className="origin-top-left"
						style={{
							transform: `scale(${leaderBoardScale})`,
						}}
					>
						<LeaderBoard forceCompactSectors={needsCompactSectors} />
					</div>
				</div>
			</section>

			<section className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-2 overflow-hidden">
				<div className="min-h-0 overflow-hidden rounded-lg border border-zinc-800">
					<Map />
				</div>

				<div className="grid min-h-0 grid-cols-2 gap-2 overflow-hidden">
					<div className="min-h-0 overflow-hidden rounded-lg border border-zinc-800 p-2">
						<RaceControl />
					</div>

					<div className="min-h-0 overflow-hidden rounded-lg border border-zinc-800 p-2">
						<TeamRadios />
					</div>
				</div>
			</section>
		</div>
	);
}
