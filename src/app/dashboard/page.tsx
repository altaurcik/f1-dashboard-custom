"use client";

import LeaderBoard from "@/components/dashboard/LeaderBoard";
import RaceControl from "@/components/dashboard/RaceControl";
import TeamRadios from "@/components/dashboard/TeamRadios";
import Map from "@/components/dashboard/Map";

export default function Page() {
	return (
		<div className="grid h-full min-h-0 w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 overflow-hidden">
			<section className="min-h-0 overflow-hidden rounded-lg border border-zinc-800 p-2">
				<div className="h-full min-h-0 overflow-hidden">
					<LeaderBoard />
				</div>
			</section>

			<section className="grid min-h-0 grid-rows-[minmax(0,1fr)_18rem] gap-2 overflow-hidden">
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
