import type { Message } from "@/types/state.type";

export type TrackFlags = { wholeTrack: boolean; sectors: Set<number> };
export type TrackFlagTone = "clear" | "yellow" | "red" | "safety";

export function resolveTrackFlags(messages: readonly Message[] | undefined): TrackFlags {
	const flags: TrackFlags = { wholeTrack: false, sectors: new Set() };
	const timestamp = (message: Message) =>
		Date.parse(/[Z]|[+-]\d\d:\d\d$/.test(message.Utc) ? message.Utc : message.Utc + "Z");
	const ordered = (messages ?? [])
		.filter((message) => ["YELLOW", "DOUBLE YELLOW", "CLEAR", "GREEN"].includes(message.Flag ?? ""))
		.slice()
		.sort((a, b) => timestamp(a) - timestamp(b));
	for (const message of ordered) {
		const yellow = message.Flag === "YELLOW" || message.Flag === "DOUBLE YELLOW";
		if (message.Scope === "Track") {
			flags.wholeTrack = yellow;
			if (message.Flag === "CLEAR") flags.sectors.clear();
		} else if (message.Scope === "Sector" && Number.isInteger(message.Sector) && (message.Sector ?? 0) > 0) {
			if (yellow) flags.sectors.add(message.Sector!);
			else flags.sectors.delete(message.Sector!);
		}
	}
	return flags;
}

export function getTrackFlagTone(flags: TrackFlags, status: string | undefined, sector?: number): TrackFlagTone {
	if (status === "5") return "red";
	if (["4", "6", "7"].includes(status ?? "")) return "safety";
	if (status === "1") return "clear";
	return flags.wholeTrack || (sector !== undefined && flags.sectors.has(sector)) ? "yellow" : "clear";
}
