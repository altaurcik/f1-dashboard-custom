import { existsSync } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import type { BenchmarkRecord, CircuitContext, LiveContext } from "@/types/live-context.type";
function localAsset(url: string, group: "logos" | "portraits") {
	if (!url) return "";
	const filename = path.basename(new URL(url).pathname);
	return /^[a-z0-9-]+\.png$/i.test(filename) &&
		existsSync(path.join(process.cwd(), "public", "reference-assets", group, filename))
		? "/reference-assets/" + group + "/" + filename
		: url;
}
const base = "https://api.formula1dashboard.com/api/v1/";
type Session = { session_key: number; session_name: string; grand_prix: CircuitContext };
type Meeting = {
	meeting_key: number;
	circuit_key: number;
	records?: { lap_record: BenchmarkRecord; track_record: BenchmarkRecord };
};
type HistoricalDriver = {
	driver_number: number;
	portrait_url: string;
	driver: { name: string };
	constructor: { car: { constructor_normalized_logo_url: string }[] };
};
async function read<T>(path: string): Promise<T> {
	const response = await fetch(base + path, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(15000) });
	if (!response.ok) throw new Error("Historical data returned HTTP " + response.status);
	return response.json() as Promise<T>;
}
export async function GET(request: NextRequest) {
	const year = Number(request.nextUrl.searchParams.get("year"));
	const meeting = Number(request.nextUrl.searchParams.get("meeting"));
	const sessionKey = Number(request.nextUrl.searchParams.get("session"));
	if (
		![year, meeting, sessionKey].every(Number.isInteger) ||
		year < 2018 ||
		year > 2100 ||
		meeting < 1 ||
		sessionKey < 1
	)
		return NextResponse.json({ error: "Invalid session identifiers" }, { status: 400 });
	try {
		const [sessions, drivers, oldMeetings] = await Promise.all([
			read<Session[]>(`sessions?year=${year}&meeting_key=${meeting}`),
			read<HistoricalDriver[]>(`drivers?year=${year}`),
			read<Meeting[]>(`grand-prix?year=${year - 1}`),
		]);
		const current = sessions.find((s) => s.session_key === sessionKey);
		if (!current) return NextResponse.json({ error: "Session metadata unavailable" }, { status: 404 });
		const circuit = current.grand_prix as CircuitContext & { circuit_key: number };
		const oldMeeting = oldMeetings.find((m) => m.circuit_key === circuit.circuit_key);
		let previous: BenchmarkRecord | null = null;
		if (oldMeeting) {
			const oldSessions = await read<Session[]>(`sessions?year=${year - 1}&meeting_key=${oldMeeting.meeting_key}`);
			const sameSession = oldSessions.find((s) => s.session_name === current.session_name);
			if (sameSession) {
				const result = await read<{
					laps: { lap_duration: number; driver_id: number }[];
					drivers: Record<string, { driver_name: string; constructor_name: string }>;
				}>(
					`laps?year=${year - 1}&meeting_key=${oldMeeting.meeting_key}&session_key=${sameSession.session_key}&limit=1&orderBy=lap_duration+asc`,
				);
				const lap = result.laps[0];
				const driver = lap && result.drivers[lap.driver_id];
				const oldDrivers = lap
					? await read<(HistoricalDriver & { driver: { full_name?: string; name: string } })[]>(
							`drivers?year=${year - 1}`,
						)
					: [];
				const previousDriver = oldDrivers.find(
					(item) => item.driver_number === (lap as unknown as { driver_number: number })?.driver_number,
				);
				if (lap && driver)
					previous = {
						time: `${Math.floor(lap.lap_duration / 60)}:${(lap.lap_duration % 60).toFixed(3).padStart(6, "0")}`,
						seconds: lap.lap_duration,
						driver_name: previousDriver?.driver.full_name || driver.driver_name,
						constructor_name: driver.constructor_name,
						year: year - 1,
					};
			}
		}
		const data: LiveContext = {
			circuit,
			previous,
			lapRecord: oldMeeting?.records?.lap_record ?? null,
			trackRecord: oldMeeting?.records?.track_record ?? null,
			portraits: Object.fromEntries(drivers.map((d) => [d.driver_number, localAsset(d.portrait_url, "portraits")])),
			logos: Object.fromEntries(
				drivers.map((d) => [
					d.driver_number,
					localAsset(
						d.constructor.car.find((c) => c.constructor_normalized_logo_url)?.constructor_normalized_logo_url ?? "",
						"logos",
					),
				]),
			),
			source: base,
		};
		return NextResponse.json(data);
	} catch {
		return NextResponse.json(
			{ circuit: null, previous: null, lapRecord: null, trackRecord: null, portraits: {}, logos: {}, source: base },
			{ headers: { "Cache-Control": "no-store" } },
		);
	}
}
