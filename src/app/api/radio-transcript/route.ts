import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const root = process.cwd();
const pythonPath =
	process.env.WHISPER_PYTHON ??
	path.join(
		root,
		".venv-whisper",
		process.platform === "win32" ? "Scripts" : "bin",
		process.platform === "win32" ? "python.exe" : "python",
	);
const scriptPath = path.join(root, "tools/transcribe_radio.py");
const cacheDir = path.join(root, ".cache/radio-transcripts");
const localEnvPath = path.join(root, ".env.local");

type Payload = {
	audioUrl?: string;
};

function validateAudioUrl(value: string): string {
	const url = new URL(value);

	if (url.protocol !== "https:" || url.hostname !== "livetiming.formula1.com") {
		throw new Error("Only Formula 1 live timing audio URLs are allowed.");
	}

	if (!url.pathname.startsWith("/static/") || !url.pathname.endsWith(".mp3")) {
		throw new Error("Only Formula 1 static .mp3 radio files are allowed.");
	}

	return url.toString();
}

function getTranscriptPath(audioUrl: string): string {
	const digest = createHash("sha256").update(audioUrl).digest("hex").slice(0, 24);
	return path.join(cacheDir, `${digest}.diarized-v5.transcript.txt`);
}

async function hasTranscript(transcriptPath: string): Promise<boolean> {
	try {
		const info = await stat(transcriptPath);
		return info.size > 0;
	} catch {
		return false;
	}
}

function extractPlainText(content: string): string {
	const marker = "\n\nPlain Text:\n";
	const markerIndex = content.indexOf(marker);

	if (markerIndex >= 0) {
		return content.slice(markerIndex + marker.length).trim();
	}

	return content
		.split("\n")
		.map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim())
		.filter(Boolean)
		.join(" ")
		.trim();
}

async function getLocalEnvValue(key: string): Promise<string | undefined> {
	try {
		const content = await readFile(localEnvPath, "utf-8");
		const line = content
			.split("\n")
			.map((item) => item.trim())
			.find((item) => item.startsWith(`${key}=`));

		if (!line) return undefined;

		const value = line.slice(key.length + 1).trim();
		return value || undefined;
	} catch {
		return undefined;
	}
}

async function getHfToken(): Promise<string | undefined> {
	return process.env.HF_TOKEN || getLocalEnvValue("HF_TOKEN");
}

function runTranscription(audioUrl: string, transcriptPath: string, hfToken: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			pythonPath,
			[
				scriptPath,
				audioUrl,
				"--output",
				transcriptPath,
				"--model-name",
				process.env.WHISPER_MODEL ?? "base.en",
				"--device",
				process.env.WHISPER_DEVICE ?? "cpu",
				"--compute-type",
				process.env.WHISPER_COMPUTE_TYPE ?? "int8",
				"--diarize",
				"--num-speakers",
				process.env.WHISPER_NUM_SPEAKERS ?? "2",
				"--min-speakers",
				process.env.WHISPER_MIN_SPEAKERS ?? "1",
				"--max-speakers",
				process.env.WHISPER_MAX_SPEAKERS ?? "2",
			],
			{
				cwd: root,
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					HF_TOKEN: hfToken,
					HF_HUB_DISABLE_PROGRESS_BARS: "1",
					MPLCONFIGDIR: path.join(root, ".cache/matplotlib"),
					XDG_CACHE_HOME: path.join(root, ".cache"),
				},
			},
		);

		let stderr = "";

		const timeout = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error("Transcription timed out."));
		}, 180_000);

		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});

		child.on("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});

		child.on("close", (code) => {
			clearTimeout(timeout);

			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(cleanTranscriptionError(stderr) || `Transcription failed with exit code ${code}.`));
		});
	});
}

function cleanTranscriptionError(stderr: string): string {
	if (stderr.includes("Cannot access gated repo")) {
		return "Hugging Face token has no access to pyannote/speaker-diarization-community-1. Open the model page and request/accept access.";
	}

	if (stderr.includes("HF_TOKEN is required")) {
		return "Configure HF_TOKEN in the server environment for speaker diarization.";
	}

	const lines = stderr
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	return lines.at(-1) ?? "";
}

async function transcriptionAvailable(): Promise<boolean> {
	if (!(await getHfToken())) return false;
	try {
		return (await stat(pythonPath)).isFile();
	} catch {
		return false;
	}
}

export async function GET() {
	return NextResponse.json({ available: await transcriptionAvailable() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
	try {
		const payload = (await request.json()) as Payload;

		if (!payload.audioUrl) {
			return NextResponse.json({ error: "audioUrl is required." }, { status: 400 });
		}

		const audioUrl = validateAudioUrl(payload.audioUrl);
		const transcriptPath = getTranscriptPath(audioUrl);
		if (!(await hasTranscript(transcriptPath))) {
			const hfToken = await getHfToken();
			if (!hfToken || !(await transcriptionAvailable())) {
				return NextResponse.json(
					{ code: "TRANSCRIPTION_UNAVAILABLE", error: "Transcript unavailable. Audio is available." },
					{ status: 503 },
				);
			}
			await mkdir(cacheDir, { recursive: true });
			await runTranscription(audioUrl, transcriptPath, hfToken);
		}

		const content = await readFile(transcriptPath, "utf-8");
		const text = extractPlainText(content);

		return NextResponse.json({ text, transcriptPath });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown transcription error.";
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
