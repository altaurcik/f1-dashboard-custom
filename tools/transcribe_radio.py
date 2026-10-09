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
        word_timestamps=args.diarize,
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
                "words": [{"start": float(word.start), "end": float(word.end), "text": word.word} for word in (segment.words or [])],
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


def transcribe_with_diarization(audio_path: Path, args: argparse.Namespace) -> tuple[list[str], str]:
    from faster_whisper.audio import decode_audio
    from radio_diarization import separate_speakers

    speech_segments = transcribe_segments(audio_path, args)
    words = [word for segment in speech_segments for word in segment["words"]]
    turns = separate_speakers(decode_audio(str(audio_path)), words, args.device, args.speaker_threshold, args.max_speakers)
    timestamped = [f"[{format_timestamp(turn['start'])} -> {format_timestamp(turn['end'])}] {turn['speaker']}: {turn['text']}" for turn in turns]
    plain_text = "\n".join(f"{turn['speaker']}: {turn['text']}" for turn in turns)
    return timestamped, plain_text


def write_transcript(output_path: Path, timestamped: list[str], plain_text: str) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    content = "\n".join(timestamped)
    if plain_text:
        content = f"{content}\n\nPlain Text:\n{plain_text}" if content else f"Plain Text:\n{plain_text}"

    output_path.write_text(content.strip() + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Transcribe a Team Radio audio file locally with faster-whisper and SpeechBrain.")
    parser.add_argument("audio", help="Path or URL to an audio file, for example .mp3")
    parser.add_argument("--output", type=Path, help="Transcript output path. Defaults to .transcript.txt next to input/cache.")
    parser.add_argument("--model-name", default="medium.en", help="Whisper model name or local model path.")
    parser.add_argument("--device", default="cpu", help="faster-whisper device, for example cpu, cuda, auto.")
    parser.add_argument("--compute-type", default="int8", help="faster-whisper compute type, for example int8 or float32.")
    parser.add_argument("--diarize", action="store_true", help="Separate acoustic voices locally with the public SpeechBrain ECAPA model (no token).")
    parser.add_argument("--speaker-threshold", type=float, default=0.4, help="Cosine-distance threshold for acoustic speaker clustering.")
    parser.add_argument("--max-speakers", type=int, default=2, help="Maximum acoustic voices; a second speaker is not forced.")
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
