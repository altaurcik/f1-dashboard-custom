from __future__ import annotations

import argparse
import hashlib
import os
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import requests
from faster_whisper import WhisperModel

try:
    import certifi

    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
    os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
except ImportError:
    pass


def format_timestamp(seconds: float) -> str:
    millis = int(round(seconds * 1000))
    hours, remainder = divmod(millis, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)

    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"

    return f"{minutes:02d}:{secs:02d}.{millis:03d}"


def default_output_path(audio: str) -> Path:
    parsed = urlparse(audio)

    if parsed.scheme in {"http", "https"}:
        digest = hashlib.sha256(audio.encode("utf-8")).hexdigest()[:24]
        return Path(".cache/radio-transcripts") / f"{digest}.transcript.txt"

    path = Path(audio)
    return path.with_suffix(f"{path.suffix}.transcript.txt")


def download_audio(url: str) -> Path:
    parsed = urlparse(url)
    suffix = Path(parsed.path).suffix or ".mp3"

    response = requests.get(url, timeout=30)
    response.raise_for_status()

    temp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    with temp:
        temp.write(response.content)

    return Path(temp.name)


def resolve_audio(audio: str) -> tuple[Path, bool]:
    parsed = urlparse(audio)

    if parsed.scheme in {"http", "https"}:
        return download_audio(audio), True

    return Path(audio), False


def transcribe_segments(audio_path: Path, args: argparse.Namespace) -> list[dict]:
    model = WhisperModel(args.model_name, device=args.device, compute_type=args.compute_type)

    segments, _info = model.transcribe(
        str(audio_path),
        language="en",
        vad_filter=True,
        vad_parameters={
            "min_silence_duration_ms": 500,
            "speech_pad_ms": 250,
        },
        beam_size=5,
        best_of=5,
        condition_on_previous_text=False,
    )

    result: list[dict] = []

    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue

        result.append(
            {
                "start": float(segment.start),
                "end": float(segment.end),
                "text": text,
            }
        )

    return result


def transcribe(audio_path: Path, args: argparse.Namespace) -> tuple[list[str], str]:
    segments = transcribe_segments(audio_path, args)
    timestamped: list[str] = []
    plain_parts: list[str] = []

    for segment in segments:
        text = segment["text"]
        timestamped.append(f"[{format_timestamp(segment['start'])} -> {format_timestamp(segment['end'])}] {text}")
        plain_parts.append(text)

    return timestamped, " ".join(plain_parts).strip()


def speaker_roles(segments: list[dict]) -> dict[str, str]:
    roles: dict[str, str] = {}

    for segment in segments:
        speaker = segment.get("speaker")
        if speaker and speaker not in roles:
            roles[speaker] = f"speaker-{len(roles) + 1}"

    return roles


def speaker_label(roles: dict[str, str], speaker: str | None) -> str:
    if not speaker:
        return "unknown"

    return roles.get(speaker, "unknown")


def starts_engineer_reply(text: str) -> bool:
    normalized = text.strip().lower()
    return normalized.startswith(
        (
            "we ",
            "we'll",
            "we will",
            "copy",
            "ok ",
            "okay",
            "understood",
            "confirm",
            "stand by",
            "box",
            "mode",
            "plan",
        )
    )


def fallback_radio_turns(segments: list[dict]) -> list[tuple[str, str]]:
    turns: list[tuple[str, str]] = []

    for segment in segments:
        text = segment.get("text", "").strip()
        if not text:
            continue

        if turns and not starts_engineer_reply(text):
            turns[-1] = ("fallback", f"{turns[-1][1]} {text}")
        else:
            turns.append(("fallback", text))

    return turns


def segment_overlap(start: float, end: float, other_start: float, other_end: float) -> float:
    return max(0.0, min(end, other_end) - max(start, other_start))


def assign_segment_speakers(segments: list[dict], diarize_segments) -> list[dict]:
    rows = diarize_segments.to_dict("records")
    assigned: list[dict] = []

    for segment in segments:
        best_speaker: str | None = None
        best_overlap = 0.0

        for row in rows:
            overlap = segment_overlap(
                float(segment["start"]),
                float(segment["end"]),
                float(row["start"]),
                float(row["end"]),
            )

            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = row.get("speaker")

        assigned.append({**segment, "speaker": best_speaker})

    return assigned


def transcribe_with_diarization(audio_path: Path, args: argparse.Namespace) -> tuple[list[str], str]:
    token = args.hf_token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if not token:
        raise RuntimeError(
            "HF_TOKEN is required for pyannote/whisperX speaker diarization. "
            "Create a Hugging Face token, accept the pyannote model terms, and export HF_TOKEN."
        )

    import whisperx
    from whisperx.diarize import DiarizationPipeline

    speech_segments = transcribe_segments(audio_path, args)
    audio = whisperx.load_audio(str(audio_path))
    diarize_model = DiarizationPipeline(
        token=token,
        device=args.device,
        cache_dir=str(Path(".cache/pyannote")),
    )
    diarize_segments = diarize_model(
        audio,
        num_speakers=args.num_speakers,
        min_speakers=args.min_speakers,
        max_speakers=args.max_speakers,
    )

    segments = assign_segment_speakers(speech_segments, diarize_segments)
    roles = speaker_roles(segments)
    timestamped: list[str] = []
    turns: list[tuple[str, str]] = []

    for segment in segments:
        text = segment.get("text", "").strip()
        if not text:
            continue

        role = speaker_label(roles, segment.get("speaker"))
        timestamped.append(f"[{format_timestamp(segment['start'])} -> {format_timestamp(segment['end'])}] - {text}")

        if turns and turns[-1][0] == role:
            turns[-1] = (role, f"{turns[-1][1]} {text}")
        else:
            turns.append((role, text))

    if len({role for role, _text in turns}) <= 1 and len(segments) > 1:
        turns = fallback_radio_turns(segments)

    plain_text = "\n".join(f"- {text}" for _role, text in turns)
    return timestamped, plain_text


def write_transcript(output_path: Path, timestamped: list[str], plain_text: str) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    content = "\n".join(timestamped)
    if plain_text:
        content = f"{content}\n\nPlain Text:\n{plain_text}" if content else f"Plain Text:\n{plain_text}"

    output_path.write_text(content.strip() + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Transcribe a Team Radio audio file locally with faster-whisper/whisperX.")
    parser.add_argument("audio", help="Path or URL to an audio file, for example .mp3")
    parser.add_argument("--output", type=Path, help="Transcript output path. Defaults to .transcript.txt next to input/cache.")
    parser.add_argument("--model-name", default="base.en", help="Whisper model name or local model path.")
    parser.add_argument("--device", default="cpu", help="faster-whisper device, for example cpu, cuda, auto.")
    parser.add_argument("--compute-type", default="int8", help="faster-whisper compute type, for example int8 or float32.")
    parser.add_argument("--diarize", action="store_true", help="Use whisperX + pyannote speaker diarization.")
    parser.add_argument("--hf-token", help="Hugging Face token for pyannote gated diarization models.")
    parser.add_argument("--batch-size", type=int, default=8, help="whisperX transcription batch size.")
    parser.add_argument("--chunk-size", type=int, default=30, help="whisperX transcription chunk size in seconds.")
    parser.add_argument("--num-speakers", type=int, default=2, help="Exact number of speakers for diarization.")
    parser.add_argument("--min-speakers", type=int, default=1, help="Minimum number of speakers for diarization.")
    parser.add_argument("--max-speakers", type=int, default=2, help="Maximum number of speakers for diarization.")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing transcript.")

    args = parser.parse_args()
    output_path = args.output or default_output_path(args.audio)

    if output_path.exists() and output_path.stat().st_size > 0 and not args.force:
        print(output_path)
        return

    audio_path, should_cleanup = resolve_audio(args.audio)

    try:
        if args.diarize:
            timestamped, plain_text = transcribe_with_diarization(audio_path, args)
        else:
            timestamped, plain_text = transcribe(audio_path, args)

        write_transcript(output_path, timestamped, plain_text)
        print(output_path)
    finally:
        if should_cleanup:
            audio_path.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit(str(error))
