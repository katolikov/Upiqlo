"""Child process that runs one UPIQAL pipeline invocation to completion.

This script exists so the parent engine can achieve **true cancellation**
of a heavy ML inference: sending SIGKILL to the child process
instantaneously frees every torch tensor, python allocator arena, and
model buffer owned by the comparison. The parent SSE handler spawns one
subworker per streamed request and kills it on cancel.

Protocol
--------
* Parent passes reference/target paths + CompareParams JSON on argv.
* Child emits upstream run_pipeline's ``[N/M] Stage ... done`` lines on
  stdout as they occur (no buffering — stdout is flushed line-by-line).
* Child emits the final JSON blob wrapped in sentinels:

      __UPIQAL_RESULT_START__
      {"score": ..., "heatmaps": {...}, ...}
      __UPIQAL_RESULT_END__

  so the parent can separate it from the mixed progress lines.
* On any error, child writes "__UPIQAL_ERROR__\\n<message>\\n" on stderr
  and exits with a non-zero code.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import tempfile
from pathlib import Path

from .params import CompareParams
from .pipeline import _HEATMAP_FILES, _build_args, _score_label_fallback, _setup_upstream


RESULT_START = "__UPIQAL_RESULT_START__"
RESULT_END = "__UPIQAL_RESULT_END__"


def main() -> None:
    # Force UTF-8 + line-buffered stdout/stderr BEFORE any other code
    # runs. On Windows the PyInstaller-frozen child inherits cp1252 as
    # the stdio encoding, which raises "'charmap' codec can't encode
    # characters" the instant upstream prints a file path containing
    # non-ASCII (e.g. a Cyrillic username like C:\Users\Артём\…).
    # PYTHONIOENCODING is unreliable inside PyInstaller bootloader, so
    # we reconfigure() explicitly here.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)  # type: ignore[attr-defined]
        except Exception:
            pass

    parser = argparse.ArgumentParser(prog="upiqal_engine.subworker")
    parser.add_argument("--reference", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--params-json", required=True)
    args = parser.parse_args()

    params = CompareParams.model_validate_json(args.params_json)

    try:
        _setup_upstream()
        import upiqal_cli  # type: ignore[import-not-found]
    except Exception as e:
        sys.stderr.write(f"__UPIQAL_ERROR__\n{e}\n")
        sys.exit(2)

    try:
        with tempfile.TemporaryDirectory(prefix="upiqal_sub_") as td:
            out_dir = Path(td)
            ns = _build_args(args.reference, args.target, out_dir, params)
            # Let upstream print its [N/M] lines directly to stdout.
            # The parent parses them live for SSE progress events.
            upiqal_cli.run_pipeline(ns)

            report_path = out_dir / "report.json"
            if not report_path.is_file():
                raise RuntimeError(f"no report.json in {out_dir}")
            report = json.loads(report_path.read_text())

            # Post-process: grayscale-background + colour-highlighted anomaly.
            try:
                from upiqal_engine.anomaly_highlight import generate_highlight

                generate_highlight(
                    target_path=Path(args.target),
                    anomaly_map_path=out_dir / "global_anomaly_map.png",
                    out_path=out_dir / "anomaly_highlight.png",
                )
            except Exception as e:
                sys.stderr.write(f"anomaly_highlight post-process failed: {e}\n")

            heatmaps: dict[str, str] = {}
            for name in _HEATMAP_FILES:
                p = out_dir / name
                if p.is_file():
                    heatmaps[name] = base64.b64encode(p.read_bytes()).decode("ascii")

            score = float(report["score"])
            label = report.get("score_label") or _score_label_fallback(score)

            result = {
                "score": score,
                "score_label": label,
                "reference_image": args.reference,
                "target_image": args.target,
                "image_resolution": report.get("image_resolution", {}),
                "diagnostics": report.get("diagnostics", {}),
                "heatmaps": heatmaps,
                "params": params.model_dump(),
            }

        # Emit sentinel-wrapped result on stdout AFTER the temp-dir closes.
        # JSON is chunked into ~32 KB lines so asyncio.StreamReader.readline()
        # on the parent side stays under its 64 KB buffer limit.
        payload = json.dumps(result)
        chunk_size = 32 * 1024
        sys.stdout.write(f"\n{RESULT_START}\n")
        for i in range(0, len(payload), chunk_size):
            sys.stdout.write(payload[i : i + chunk_size])
            sys.stdout.write("\n")
        sys.stdout.write(f"{RESULT_END}\n")
        sys.stdout.flush()

    except Exception as e:
        sys.stderr.write(f"__UPIQAL_ERROR__\n{e}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
