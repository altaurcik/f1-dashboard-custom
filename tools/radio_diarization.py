from __future__ import annotations

import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import pdist

MODEL_ID = "speechbrain/spkrec-ecapa-voxceleb"
MODEL_REVISION = "0f99f2d0ebe89ac095bcc5903c4dd8f72b367286"


def cluster_voices(embeddings: np.ndarray, threshold: float = 0.4, max_speakers: int = 2) -> list[int]:
    """Cluster acoustic identities; never force a second voice into a one-speaker clip."""
    if len(embeddings) < 2:
        return [0] * len(embeddings)
    distances = np.clip(pdist(embeddings, metric="cosine"), 0, 2)
    tree = linkage(distances, method="average")
    labels = fcluster(tree, t=threshold, criterion="distance")
    if len(set(labels)) > max_speakers:
        labels = fcluster(tree, t=max_speakers, criterion="maxclust")
    return [int(value) for value in labels]


def speech_windows(audio: np.ndarray) -> list[dict]:
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    spans = get_speech_timestamps(audio, VadOptions(min_speech_duration_ms=250, min_silence_duration_ms=180, speech_pad_ms=40))
    windows: list[dict] = []
    for span in spans:
        start, end = span["start"] / 16000, span["end"] / 16000
        # Overlapping windows also cover a voice change without an ASR segment boundary.
        if end - start <= 1.5:
            windows.append({"start": start, "end": end})
            continue
        offsets = list(np.arange(start, end - 1.5, 0.5)) + [end - 1.5]
        windows.extend({"start": float(offset), "end": float(offset + 1.5)} for offset in offsets)
    return windows


def assign_words(words: list[dict], windows: list[dict]) -> list[dict]:
    assigned: list[dict] = []
    for word in words:
        center = (word["start"] + word["end"]) / 2
        nearest = min(windows, key=lambda window: abs((window["start"] + window["end"]) / 2 - center)) if windows else None
        assigned.append({**word, "speaker": nearest.get("speaker") if nearest else None})
    return assigned


def group_turns(words: list[dict]) -> list[dict]:
    turns: list[dict] = []
    labels: dict[int, str] = {}
    for word in words:
        speaker = word.get("speaker")
        if speaker is not None and speaker not in labels:
            labels[speaker] = f"Speaker {len(labels) + 1}"
        name = labels.get(speaker, "Unknown speaker")
        if turns and turns[-1]["speaker"] == name and word["start"] - turns[-1]["end"] < 1:
            turns[-1]["text"] += word["text"]
            turns[-1]["end"] = word["end"]
        else:
            turns.append({"speaker": name, "start": word["start"], "end": word["end"], "text": word["text"]})
    return [{**turn, "text": turn["text"].strip()} for turn in turns if turn["text"].strip()]


def separate_speakers(audio: np.ndarray, words: list[dict], device: str = "cpu", threshold: float = 0.4, max_speakers: int = 2) -> list[dict]:
    import torch
    from speechbrain.inference.speaker import EncoderClassifier
    from speechbrain.utils.fetching import LocalStrategy

    windows = speech_windows(audio)
    if not windows or not words:
        return group_turns(assign_words(words, []))
    model = EncoderClassifier.from_hparams(
        source=MODEL_ID,
        revision=MODEL_REVISION,
        savedir=".cache/speechbrain/ecapa-voxceleb",
        local_strategy=LocalStrategy.COPY,
        use_auth_token=False,
        run_opts={"device": device},
    )
    embeddings: list[np.ndarray] = []
    for window in windows:
        crop = audio[int(window["start"] * 16000):int(window["end"] * 16000)]
        # The encoder needs enough frames; repeat a very short utterance without adding a voice.
        if len(crop) < 8000:
            crop = np.tile(crop, int(np.ceil(8000 / max(1, len(crop)))))[:8000]
        with torch.inference_mode():
            embedding = model.encode_batch(torch.from_numpy(crop).unsqueeze(0)).detach().cpu().numpy().reshape(-1)
        embeddings.append(embedding)
    labels = cluster_voices(np.asarray(embeddings), threshold, max_speakers)
    for window, speaker in zip(windows, labels):
        window["speaker"] = speaker
    return group_turns(assign_words(words, windows))
