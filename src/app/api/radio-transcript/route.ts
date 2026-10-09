import { NextRequest, NextResponse } from "next/server";
import { transcriptionStatus, transcribeRadio, validateAudioUrl } from "@/lib/server/radioTranscription";

export const runtime = "nodejs";

export async function GET() {
	return NextResponse.json(await transcriptionStatus(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
	let audioUrl: string;
	try {
		const payload = await request.json();
		audioUrl = validateAudioUrl(payload?.audioUrl);
	} catch {
		return NextResponse.json({ error: "A valid Formula 1 static HTTPS .mp3 audioUrl is required." }, { status: 400 });
	}
	try {
		// The service can serve an existing local cache even if the runtime is unavailable.
		return NextResponse.json({ text: await transcribeRadio(audioUrl) });
	} catch (error) {
		const status = await transcriptionStatus();
		const message = error instanceof Error ? error.message : "Local transcription failed.";
		return NextResponse.json(
			{ code: status.available ? "TRANSCRIPTION_FAILED" : "TRANSCRIPTION_UNAVAILABLE", error: message },
			{ status: status.available ? 500 : 503 },
		);
	}
}
