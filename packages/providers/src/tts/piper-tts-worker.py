import base64
import io
import json
import sys
import wave

from piper.config import SynthesisConfig
from piper.voice import PiperVoice


def make_response(request_id, ok, payload=None, error=None):
    response = {"id": request_id, "ok": ok}
    if payload is not None:
        response["payload"] = payload
    if error is not None:
        response["error"] = error
    return response


def clamp(value, minimum, maximum):
    return max(minimum, min(value, maximum))


def speaking_rate_to_length_scale(speaking_rate):
    if speaking_rate is None:
        return None

    rate = float(speaking_rate)
    rate = clamp(rate, 0.7, 1.35)
    return clamp(1.0 / rate, 0.74, 1.42)


def build_wav_base64(voice, text, default_speaker_id, sentence_silence_ms, speaking_rate, speaker_id):
    resolved_speaker_id = speaker_id
    if resolved_speaker_id is None:
        resolved_speaker_id = default_speaker_id

    synth_config = SynthesisConfig(
        speaker_id=resolved_speaker_id,
        length_scale=speaking_rate_to_length_scale(speaking_rate),
    )

    audio_bytes = bytearray()
    sample_rate = None
    sample_width = None
    sample_channels = None

    silence_frames = 0

    for chunk in voice.synthesize(text, syn_config=synth_config):
        sample_rate = chunk.sample_rate
        sample_width = chunk.sample_width
        sample_channels = chunk.sample_channels

        chunk_bytes = chunk.audio_int16_bytes
        if not chunk_bytes:
            continue

        if audio_bytes and sentence_silence_ms > 0:
            if silence_frames == 0:
                silence_frames = round(sample_rate * (sentence_silence_ms / 1000.0))
            silence_byte_count = silence_frames * sample_width * sample_channels
            audio_bytes.extend(b"\x00" * silence_byte_count)

        audio_bytes.extend(chunk_bytes)

    if sample_rate is None:
        return {"audioBase64": "", "mimeType": "audio/wav", "durationMs": 0}

    with io.BytesIO() as wav_buffer:
        with wave.open(wav_buffer, "wb") as wav_file:
            wav_file.setnchannels(sample_channels)
            wav_file.setsampwidth(sample_width)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(bytes(audio_bytes))

        duration_ms = 0
        frame_width = sample_width * sample_channels
        if frame_width > 0 and sample_rate > 0:
            duration_ms = round((len(audio_bytes) / frame_width) / sample_rate * 1000)

        return {
            "audioBase64": base64.b64encode(wav_buffer.getvalue()).decode("ascii"),
            "mimeType": "audio/wav",
            "durationMs": duration_ms,
        }


def main():
    if len(sys.argv) < 2:
        raise SystemExit("model path required")

    model_path = sys.argv[1]
    config_path = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
    default_speaker_id = (
        int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].strip() else None
    )
    sentence_silence_ms = int(sys.argv[4]) if len(sys.argv) > 4 else 120

    voice = PiperVoice.load(model_path, config_path=config_path)

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        request = json.loads(line)
        request_id = request.get("id")
        action = request.get("action")

        try:
            if action == "health":
                print(json.dumps(make_response(request_id, True, {"ready": True})), flush=True)
                continue

            if action != "synthesize":
                print(
                    json.dumps(
                        make_response(request_id, False, error=f"Unsupported action: {action}")
                    ),
                    flush=True,
                )
                continue

            text = (request.get("text") or "").strip()
            if not text:
                print(
                    json.dumps(
                        make_response(
                            request_id,
                            True,
                            {"audioBase64": "", "mimeType": "audio/wav", "durationMs": 0},
                        )
                    ),
                    flush=True,
                )
                continue

            speaker_id = request.get("speaker_id")
            if speaker_id is not None:
                speaker_id = int(speaker_id)

            payload = build_wav_base64(
                voice,
                text,
                default_speaker_id=default_speaker_id,
                sentence_silence_ms=sentence_silence_ms,
                speaking_rate=request.get("speaking_rate"),
                speaker_id=speaker_id,
            )
            print(json.dumps(make_response(request_id, True, payload)), flush=True)
        except Exception as error:
            print(
                json.dumps(make_response(request_id, False, error=str(error))),
                flush=True,
            )


if __name__ == "__main__":
    main()
