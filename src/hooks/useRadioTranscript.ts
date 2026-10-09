"use client";
import { useCallback, useEffect, useState } from "react";

type State = { audioUrl: string; phase: "idle" | "queued" | "loading" | "ready" | "error"; text: string };
const requests = new Map<string, Promise<string>>();
let queue = Promise.resolve();
function requestTranscript(audioUrl: string): Promise<string> {
	const existing = requests.get(audioUrl);
	if (existing) return existing;
	const task = queue.then(async () => {
		const response = await fetch("/api/radio-transcript", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ audioUrl }),
		});
		const data = (await response.json()) as { text?: string; error?: string };
		if (!response.ok) throw new Error(data.error || "Local transcription failed.");
		return data.text?.trim() || "No speech detected.";
	});
	requests.set(audioUrl, task);
	queue = task.then(
		() => undefined,
		() => undefined,
	);
	void task.catch(() => requests.delete(audioUrl));
	// Keep a bounded browser cache; the server also saves transcripts to disk.
	if (requests.size > 100) requests.delete(requests.keys().next().value!);
	return task;
}
export function useRadioTranscript(audioUrl: string, automatic = false) {
	const [state, setState] = useState<State>({ audioUrl, phase: "idle", text: "" });
	const current: State = state.audioUrl === audioUrl ? state : { audioUrl, phase: "idle", text: "" };
	const load = useCallback(() => {
		setState({ audioUrl, phase: "loading", text: "Transcribing locally…" });
		void requestTranscript(audioUrl).then(
			(text) => setState((current) => (current.audioUrl === audioUrl ? { audioUrl, phase: "ready", text } : current)),
			(error) =>
				setState({
					audioUrl,
					phase: "error",
					text: error instanceof Error ? error.message : "Local transcription failed.",
				}),
		);
	}, [audioUrl]);
	useEffect(() => {
		if (!automatic) return;
		let active = true;
		// Strict Mode cleanup cancels work before it starts; started jobs finish into the shared cache.
		void Promise.resolve()
			.then(async () => {
				if (!active) return;
				setState({ audioUrl, phase: "queued", text: "Queued for local transcription…" });
				const response = await fetch("/api/radio-transcript", { cache: "no-store" });
				const status = (await response.json()) as { available?: boolean; reason?: string };
				if (!response.ok || !status.available) throw new Error(status.reason || "Local transcription is unavailable.");
				const text = await requestTranscript(audioUrl);
				// A new capture may move this card out of the latest five while recognition is running.
				setState((current) => (current.audioUrl === audioUrl ? { audioUrl, phase: "ready", text } : current));
			})
			.catch((error) => {
				setState((current) =>
					current.audioUrl === audioUrl
						? {
								audioUrl,
								phase: "error",
								text: error instanceof Error ? error.message : "Local transcription failed.",
							}
						: current,
				);
			});
		return () => {
			active = false;
		};
	}, [audioUrl, automatic]);
	return { ...current, load };
}
