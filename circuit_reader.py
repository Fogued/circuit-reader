"""Read component values from circuit-diagram images.

A YOLO detector finds the components and the text labels, a fine-tuned TrOCR model reads each label, and a
unit-aware rule attaches every label to a component. This is a port of the inference logic of
``circuit-reader.ipynb`` (sections 2.1, 3.1 and 3.2).

The pure functions need only ``numpy``. ``ultralytics``, ``transformers``, ``torch``, ``cv2`` and ``PIL`` are
imported lazily, inside :class:`CircuitReader`.
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np

Box = Sequence[float] | np.ndarray

# Unit -> component classes that can carry that unit.
UNIT_CLASSES: dict[str, set[str]] = {
    "AC": {"V-AC", "I-AC"},
    "Hz": {"V-AC", "I-AC"},
    "Ω": {"Resistor"},
    "F": {"Capacitor"},
    "H": {"Inductor"},
    "V": {"V-DC", "V-DC (one port)", "V-AC"},
    "A": {"I-DC", "I-AC"},
}
# Every class that can carry a value.
VALUE_CLASSES: set[str] = set().union(*UNIT_CLASSES.values())
# Unit appended to a bare number ("1k") next to a component of this class.
DEFAULT_UNIT: dict[str, str] = {
    "Resistor": "Ω",
    "Capacitor": "F",
    "Inductor": "H",
    "V-DC": "V",
    "V-DC (one port)": "V",
    "I-DC": "A",
}
TEXT_CLS = 17  # class id of "text" in the detector trained by the notebook
DEFAULT_COMP_CONF = 0.71
DEFAULT_TEXT_CONF = 0.59


def norm(text: str) -> str:
    """Remove spaces; map the micro sign (U+00B5) to mu (U+03BC) and the ohm sign (U+2126) to omega (U+03A9)."""
    return text.replace(" ", "").replace("µ", "μ").replace("Ω", "Ω")


def unit_of(text: str) -> str | None:
    """Unit found in a label: "AC" for sin/cos, else the first of Hz, ohm, F, H, V, A that occurs, else None.

    The order matters: "Hz" is checked before "H", and a text with both V and A (e.g. "5VA") is read as V.
    """
    t = norm(text)
    if "sin" in t or "cos" in t:
        return "AC"
    for u in ("Hz", "Ω", "F", "H", "V", "A"):
        if u in t:
            return u
    return None


def with_unit(text: str, cls: str) -> str:
    """Append the default unit of ``cls`` if the text has none ("1k" next to a resistor -> "1k" + ohm)."""
    return text if unit_of(text) or cls not in DEFAULT_UNIT else text + DEFAULT_UNIT[cls]


def box_gap(a: Box, b: Box) -> float:
    """Distance between two ``(x1, y1, x2, y2)`` boxes, 0 if they touch or overlap."""
    dx = max(b[0] - a[2], a[0] - b[2], 0)
    dy = max(b[1] - a[3], a[1] - b[3], 0)
    return float(np.hypot(dx, dy))


def match_image(
    texts: Sequence[tuple[str, Box]], comps: Sequence[tuple[str, Box]], use_units: bool = True
) -> list[int | None]:
    """Index in ``comps`` of the component chosen for each ``(text, box)``, or None if there is no candidate.

    The unit of the text restricts the possible classes; without a unit (or with ``use_units=False``) any class
    in ``VALUE_CLASSES`` is allowed. Among the candidates the nearest box wins (ties go to the lower index).
    """
    out: list[int | None] = []
    for text, tb in texts:
        u = unit_of(text) if use_units else None
        allowed = UNIT_CLASSES[u] if u else VALUE_CLASSES
        cands = [(box_gap(tb, cb), j) for j, (c, cb) in enumerate(comps) if c in allowed]
        out.append(min(cands)[1] if cands else None)
    return out


def iou_matrix(a: Any, b: Any) -> np.ndarray:
    """Pairwise IoU between two lists of ``(x1, y1, x2, y2)`` boxes, shape ``(len(a), len(b))``."""
    a, b = np.asarray(a, float).reshape(-1, 4), np.asarray(b, float).reshape(-1, 4)
    tl, br = np.maximum(a[:, None, :2], b[None, :, :2]), np.minimum(a[:, None, 2:], b[None, :, 2:])
    inter = np.clip(br - tl, 0, None).prod(2)

    def area(x: np.ndarray) -> np.ndarray:
        return (x[:, 2] - x[:, 0]) * (x[:, 3] - x[:, 1])

    result: np.ndarray = inter / (area(a)[:, None] + area(b)[None, :] - inter + 1e-9)
    return result


def crop(img: np.ndarray, box: Box, pad: int = 4) -> np.ndarray:
    """Crop ``box`` (x1, y1, x2, y2) from an HxWxC image with ``pad`` px of margin, clipped to the image."""
    h, w = img.shape[:2]
    x1, y1, x2, y2 = (int(round(float(v))) for v in box)
    return img[max(y1 - pad, 0) : min(y2 + pad, h), max(x1 - pad, 0) : min(x2 + pad, w)].copy()


class CircuitReader:
    """Detector (YOLO) + reader (fine-tuned TrOCR) + matching rule.

    ``detector`` is the path to ``best.pt``; ``reader`` is the folder written by the notebook
    (``trocr_values``: model and processor). ``device`` defaults to CUDA when available, else CPU.
    """

    def __init__(
        self,
        detector: str | Path,
        reader: str | Path,
        device: str | None = None,
        comp_conf: float = DEFAULT_COMP_CONF,
        text_conf: float = DEFAULT_TEXT_CONF,
        imgsz: int = 1024,
    ) -> None:
        import torch
        from transformers import TrOCRProcessor, VisionEncoderDecoderModel
        from ultralytics import YOLO

        self.device: str = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.comp_conf = comp_conf
        self.text_conf = text_conf
        self.imgsz = imgsz
        self.detector = YOLO(str(detector))
        names: dict[int, str] = dict(self.detector.names)
        self.names = names
        self.text_cls: int = next(i for i, n in names.items() if n == "text")
        self.processor = TrOCRProcessor.from_pretrained(str(reader))
        self.ocr = VisionEncoderDecoderModel.from_pretrained(str(reader)).to(self.device)
        self.ocr.eval()

    def read_texts(self, crops: list[np.ndarray], batch_size: int = 32) -> list[str]:
        """Read RGB crops with TrOCR, in batches; the strings are normalised with :func:`norm`."""
        import torch
        from PIL import Image

        out: list[str] = []
        for i in range(0, len(crops), batch_size):
            images = [Image.fromarray(c) for c in crops[i : i + batch_size]]
            pv = self.processor(images=images, return_tensors="pt").pixel_values.to(self.device)
            with torch.no_grad(), torch.autocast(self.device, dtype=torch.float16, enabled=self.device == "cuda"):
                ids = self.ocr.generate(pv, max_new_tokens=16)
            out += [norm(t) for t in self.processor.batch_decode(ids, skip_special_tokens=True)]
        return out

    def read(self, path: str | Path) -> tuple[list[tuple[str, np.ndarray]], list[dict[str, Any]]]:
        """Run the full pipeline on one image.

        Returns ``(components, texts)``: components are ``(class, box)``; each text is a dict with
        ``text, text_box, cls, comp_box, value`` (the last three are None if it was not attached).
        """
        import cv2

        bgr = cv2.imread(str(path))  # YOLO expects BGR arrays
        if bgr is None:
            raise FileNotFoundError(f"cannot read image: {path}")
        img = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)  # TrOCR crops in RGB
        yolo_device: str | int = 0 if self.device == "cuda" else self.device
        res = self.detector.predict(
            bgr, imgsz=self.imgsz, conf=min(self.comp_conf, self.text_conf), device=yolo_device, verbose=False
        )[0].boxes
        k = res.cls.cpu().numpy().astype(int)
        s = res.conf.cpu().numpy()
        xyxy = res.xyxy.cpu().numpy()
        comps = [
            (self.names[int(c)], box)
            for c, sc, box in zip(k, s, xyxy, strict=True)
            if c != self.text_cls and sc >= self.comp_conf
        ]
        tb = xyxy[(k == self.text_cls) & (s >= self.text_conf)]
        texts = self.read_texts([crop(img, t) for t in tb]) if len(tb) else []
        links = match_image(list(zip(texts, tb, strict=True)), comps)
        rows = [
            {
                "text": t,
                "text_box": box,
                "cls": comps[j][0] if j is not None else None,
                "comp_box": comps[j][1] if j is not None else None,
                "value": with_unit(t, comps[j][0]) if j is not None else None,
            }
            for t, box, j in zip(texts, tb, links, strict=True)
        ]
        return comps, rows


def _main() -> None:
    p = argparse.ArgumentParser(description="Read component values from a circuit-diagram image.")
    p.add_argument("image", type=Path)
    p.add_argument("--detector", type=Path, required=True, help="YOLO weights (best.pt)")
    p.add_argument("--reader", type=Path, required=True, help="fine-tuned TrOCR folder (trocr_values)")
    p.add_argument("--comp-conf", type=float, default=DEFAULT_COMP_CONF)
    p.add_argument("--text-conf", type=float, default=DEFAULT_TEXT_CONF)
    args = p.parse_args()
    reader = CircuitReader(args.detector, args.reader, comp_conf=args.comp_conf, text_conf=args.text_conf)
    comps, rows = reader.read(args.image)
    result = {
        "components": [{"cls": c, "box": [float(v) for v in box]} for c, box in comps],
        "texts": [
            {
                **r,
                "text_box": [float(v) for v in r["text_box"]],
                "comp_box": None if r["comp_box"] is None else [float(v) for v in r["comp_box"]],
            }
            for r in rows
        ],
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    _main()
