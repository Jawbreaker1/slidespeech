import json
import sys
from pathlib import Path

from faster_whisper import WhisperModel


def make_response(request_id, ok, payload=None, error=None):
    response = {"id": request_id, "ok": ok}
    if payload is not None:
        response["payload"] = payload
    if error is not None:
        response["error"] = error
    return response


def main():
    if len(sys.argv) < 2:
      raise SystemExit("model name/path required")

    model_name = sys.argv[1]
    compute_type = sys.argv[2] if len(sys.argv) > 2 else "int8"
    beam_size = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    language = sys.argv[4] if len(sys.argv) > 4 else "en"

    model = WhisperModel(model_name, compute_type=compute_type)

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

            if action != "transcribe":
                print(
                    json.dumps(
                        make_response(request_id, False, error=f"Unsupported action: {action}")
                    ),
                    flush=True,
                )
                continue

            audio_path = request.get("audio_path")
            if not audio_path:
                raise ValueError("audio_path is required")

            audio_file = Path(audio_path)
            if not audio_file.exists():
                raise FileNotFoundError(f"Audio file not found: {audio_path}")

            segments, info = model.transcribe(
                str(audio_file),
                beam_size=beam_size,
                language=language,
                vad_filter=False,
                word_timestamps=False,
                condition_on_previous_text=False,
            )

            text = " ".join(segment.text.strip() for segment in segments).strip()
            confidence = 0.0
            if getattr(info, "language_probability", None) is not None:
                confidence = float(info.language_probability)
            elif text:
                confidence = 0.8

            payload = {
                "text": text,
                "confidence": max(0.0, min(confidence, 1.0)),
                "isFinal": True,
                "language": getattr(info, "language", language),
            }
            print(json.dumps(make_response(request_id, True, payload)), flush=True)
        except Exception as error:
            print(
                json.dumps(make_response(request_id, False, error=str(error))),
                flush=True,
            )


if __name__ == "__main__":
    main()
