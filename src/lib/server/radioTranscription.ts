import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type RadioConfig = ReturnType<typeof radioConfig>;
export function radioConfig() {
	const root = process.cwd();
	return {
		root,
		python:
			process.env.WHISPER_PYTHON ||
			path.join(root, ".venv-whisper", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
		script: path.join(root, "tools/transcribe_radio.py"),
		cache: path.join(root, ".cache/radio-transcripts"),
		model: process.env.WHISPER_MODEL || "medium.en",
		device: process.env.WHISPER_DEVICE || "cpu",
		computeType: process.env.WHISPER_COMPUTE_TYPE || "int8",
		diarize: process.env.WHISPER_DIARIZE !== "0",
		speakerThreshold: process.env.WHISPER_SPEAKER_THRESHOLD || "0.4",
		maxSpeakers: process.env.WHISPER_MAX_SPEAKERS || "2",
		token: process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN,
	};
}

export function validateAudioUrl(value: unknown): string {
	if (typeof value !== "string") throw new Error("audioUrl is required.");
	const url = new URL(value);
	if (
		url.protocol !== "https:" ||
		url.hostname !== "livetiming.formula1.com" ||
		url.port ||
		url.username ||
		url.password ||
		!url.pathname.startsWith("/static/") ||
		!url.pathname.endsWith(".mp3")
	) {
		throw new Error("Only Formula 1 static HTTPS .mp3 radio URLs are allowed.");
	}
	return url.toString();
}

export function extractPlainText(content: string): string {
	const normalized = content.replaceAll("\r\n", "\n");
	const match = /(?:^|\n)Plain Text:\n/.exec(normalized);
	if (match) return normalized.slice(match.index + match[0].length).trim();
	return normalized
		.split("\n")
		.map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim())
		.filter(Boolean)
		.join(" ")
		.trim();
}

export function transcriptPath(audioUrl: string, config: RadioConfig): string {
	// Separate model/mode caches so changing recognition settings does not reuse old text.
	const digest = createHash("sha256")
		.update(
			JSON.stringify([
				audioUrl,
				config.model,
				config.diarize,
				config.device,
				config.computeType,
				config.speakerThreshold,
				config.maxSpeakers,
			]),
		)
		.digest("hex")
		.slice(0, 24);
	return path.join(config.cache, digest + ".speechbrain-v1.transcript.txt");
}

function runPython(config: RadioConfig, args: string[], timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(config.python, args, {
			cwd: config.root,
			windowsHide: true,
			stdio: ["ignore", "ignore", "pipe"],
			env: {
				...process.env,
				// All active models are public; preserve the saved token without using it here.
				HF_TOKEN: "",
				HUGGINGFACE_TOKEN: "",
				HF_HUB_DISABLE_IMPLICIT_TOKEN: "1",
				PYTHONUTF8: "1",
				HF_HUB_DISABLE_PROGRESS_BARS: "1",
				MPLCONFIGDIR: path.join(config.root, ".cache/matplotlib"),
			},
		});
		let stderr = "";
		const timeout = setTimeout(() => {
			child.kill();
			reject(new Error("Local transcription timed out."));
		}, timeoutMs);
		child.stderr.on("data", (chunk) => {
			stderr = (stderr + chunk.toString()).slice(-16_000);
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
			const message = stderr.trim().split("\n").at(-1) || "Python transcription failed (exit " + code + ").";
			reject(new Error(config.token ? message.replaceAll(config.token, "[redacted]") : message));
		});
	});
}

type Availability = { available: boolean; reason?: string; model: string; diarization: boolean };
let lastProbe: { key: string; expires: number; result: Promise<Availability> } | undefined;
export async function transcriptionStatus(config = radioConfig()): Promise<Availability> {
	const key = JSON.stringify([config.python, config.diarize, config.model]);
	if (lastProbe?.key === key && lastProbe.expires > Date.now()) return lastProbe.result;
	const result = (async (): Promise<Availability> => {
		const info = { model: config.model, diarization: config.diarize };
		try {
			await runPython(
				config,
				[
					"-c",
					config.diarize
						? "import faster_whisper, requests; from speechbrain.inference.speaker import EncoderClassifier"
						: "import faster_whisper, requests",
				],
				30_000,
			);
			return { ...info, available: true };
		} catch {
			return {
				...info,
				available: false,
				reason:
					"Local Whisper runtime is unavailable. Install tools/whisper-requirements.txt into .venv-whisper or configure WHISPER_PYTHON.",
			};
		}
	})();
	lastProbe = { key, expires: Date.now() + 30_000, result };
	return result;
}

let queue: Promise<unknown> = Promise.resolve();
const pending = new Map<string, Promise<string>>();
export function transcribeRadio(audioUrl: string, config = radioConfig()): Promise<string> {
	const output = transcriptPath(audioUrl, config);
	const existing = pending.get(output);
	if (existing) return existing;
	const task = queue.then(async () => {
		try {
			if ((await stat(output)).size > 0) return extractPlainText(await readFile(output, "utf8"));
		} catch {
			/* Missing transcript: recognize locally. */
		}
		const status = await transcriptionStatus(config);
		if (!status.available) throw new Error(status.reason);
		await mkdir(config.cache, { recursive: true });
		const args = [
			config.script,
			audioUrl,
			"--output",
			output,
			"--model-name",
			config.model,
			"--device",
			config.device,
			"--compute-type",
			config.computeType,
		];
		if (config.diarize)
			args.push("--diarize", "--speaker-threshold", config.speakerThreshold, "--max-speakers", config.maxSpeakers);
		await runPython(config, args, 300_000);
		return extractPlainText(await readFile(output, "utf8"));
	});
	pending.set(output, task);
	queue = task.catch(() => undefined);
	void task.finally(() => pending.delete(output)).catch(() => undefined);
	return task;
}
