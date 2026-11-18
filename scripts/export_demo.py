"""Run the real pipeline on images and write the demo examples of the web app.

For every image this writes ``<out>/<stem>.json`` (the ``ReadResult`` of the API), copies the image next to it
and updates ``<out>/index.json``. It needs the trained weights::

    python scripts/export_demo.py img1.jpg img2.png --detector best.pt --reader trocr_values
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from circuit_reader import DEFAULT_COMP_CONF, DEFAULT_TEXT_CONF, CircuitReader  # noqa: E402


def update_index(out: Path, entry: dict[str, str]) -> None:
    """Add ``entry`` to ``out/index.json`` (replacing the entry with the same id)."""
    path = out / "index.json"
    items: list[dict[str, str]] = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    items = [i for i in items if i["id"] != entry["id"]] + [entry]
    path.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("images", nargs="+", type=Path)
    p.add_argument("--detector", type=Path, required=True, help="YOLO weights (best.pt)")
    p.add_argument("--reader", type=Path, required=True, help="fine-tuned TrOCR folder (trocr_values)")
    p.add_argument("--out", type=Path, default=REPO_ROOT / "frontend" / "public" / "demo")
    p.add_argument("--comp-conf", type=float, default=DEFAULT_COMP_CONF)
    p.add_argument("--text-conf", type=float, default=DEFAULT_TEXT_CONF)
    args = p.parse_args()

    import cv2

    seen: dict[str, Path] = {}
    for path in args.images:
        key = path.stem.casefold()
        if key == "index":
            sys.exit(f"image name '{path.name}' is reserved (index.json is the example list); rename it")
        if key in seen:
            sys.exit(f"duplicate image name '{path.stem}': {seen[key]} and {path} (names compare case-insensitively)")
        seen[key] = path

    reader = CircuitReader(args.detector, args.reader, comp_conf=args.comp_conf, text_conf=args.text_conf)
    args.out.mkdir(parents=True, exist_ok=True)
    for path in args.images:
        bgr = cv2.imread(str(path))
        if bgr is None:
            sys.exit(f"cannot read image: {path}")
        result = reader.read_image(bgr, path.name)
        (args.out / f"{path.stem}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        shutil.copyfile(path, args.out / path.name)
        update_index(args.out, {"id": path.stem, "title": path.stem, "image": path.name, "result": f"{path.stem}.json"})
        print(f"{path.name}: {len(result['components'])} components, {len(result['texts'])} texts")


if __name__ == "__main__":
    main()
