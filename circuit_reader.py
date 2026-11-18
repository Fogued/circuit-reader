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
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np

Box = Sequence[float] | np.ndarray

# Unit -> component classes that can carry that unit.
UNIT_CLASSES: dict[str, set[str]] = {
    "AC": {"V-AC", "I-AC"},
    "Hz": {"V-AC", "I-AC"},
    "\u03a9": {"Resistor"},
    "F": {"Capacitor"},
    "H": {"Inductor"},
    "V": {"V-DC", "V-DC (one port)", "V-AC"},
    "A": {"I-DC", "I-AC"},
}
# Every class that can carry a value.
VALUE_CLASSES: set[str] = set().union(*UNIT_CLASSES.values())
# Unit appended to a bare number ("1k") next to a component of this class.
DEFAULT_UNIT: dict[str, str] = {
    "Resistor": "\u03a9",
    "Capacitor": "F",
    "Inductor": "H",
    "V-DC": "V",
    "V-DC (one port)": "V",
    "I-DC": "A",
}
TEXT_CLS = 17  # informational: the class id of "text" in the notebook detector; CircuitReader looks it up by name
# Thresholds chosen on the validation set (results/detection_summary.json)
DEFAULT_COMP_CONF = 0.7057057057057057
DEFAULT_TEXT_CONF = 0.5885885885885885


def norm(text: str) -> str:
    """Remove spaces; map the micro sign (U+00B5) to mu (U+03BC) and the ohm sign (U+2126) to omega (U+03A9)."""
    return text.replace(" ", "").replace("µ", "μ").replace("Ω", "\u03a9")


def unit_of(text: str) -> str | None:
    """Unit found in a label: "AC" for sin/cos, else the first of Hz, ohm, F, H, V, A that occurs, else None.

    The order matters: "Hz" is checked before "H", and a text with both V and A (e.g. "5VA") is read as V.
    """
    t = norm(text)
    if "sin" in t or "cos" in t:
        return "AC"
    for u in ("Hz", "\u03a9", "F", "H", "V", "A"):
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


def text_mask(cls_ids: np.ndarray, confs: np.ndarray, text_cls: int, text_conf: float) -> np.ndarray:
    """Boolean mask of the detections that are text boxes with confidence >= ``text_conf``."""
    return (np.asarray(cls_ids) == text_cls) & (np.asarray(confs) >= text_conf)


def build_result(
    cls_ids: Any,
    confs: Any,
    xyxy: Any,
    texts: Sequence[str],
    names: Mapping[int, str],
    *,
    text_cls: int,
    size: tuple[int, int],
    name: str = "image",
    comp_conf: float = DEFAULT_COMP_CONF,
    text_conf: float = DEFAULT_TEXT_CONF,
) -> dict[str, Any]:
    """Turn detections into the JSON-ready result of the web API (pure, numpy only).

    ``cls_ids``, ``confs`` and ``xyxy`` describe every detection; components keep those with confidence
    >= ``comp_conf``, texts those of class ``text_cls`` with confidence >= ``text_conf``. ``texts`` holds one
    string per kept text box, in detection order. ``size`` is ``(width, height)``. Components get the ids
    ``c0, c1, ...`` and texts ``t0, t1, ...``; each text links to a component through :func:`match_image`.
    """
    k = np.asarray(cls_ids).astype(int).reshape(-1)
    s = np.asarray(confs, float).reshape(-1)
    boxes = np.asarray(xyxy, float).reshape(-1, 4)
    text_idx = np.flatnonzero(text_mask(k, s, text_cls, text_conf))
    if len(texts) != len(text_idx):
        raise ValueError(f"expected {len(text_idx)} texts, got {len(texts)}")
    comp_idx = np.flatnonzero((k != text_cls) & (s >= comp_conf))

    def box_list(i: Any) -> list[float]:
        return [round(float(v), 2) for v in boxes[i]]

    comp_names = [names[int(k[i])] for i in comp_idx]
    links = match_image(
        [(t, boxes[i]) for t, i in zip(texts, text_idx, strict=True)],
        [(c, boxes[i]) for c, i in zip(comp_names, comp_idx, strict=True)],
    )
    components = [
        {"id": f"c{n}", "cls": c, "box": box_list(i), "conf": round(float(s[i]), 4)}
        for n, (c, i) in enumerate(zip(comp_names, comp_idx, strict=True))
    ]
    text_items = [
        {
            "id": f"t{n}",
            "text": t,
            "box": box_list(i),
            "conf": round(float(s[i]), 4),
            "component_id": f"c{j}" if j is not None else None,
            "value": with_unit(t, comp_names[j]) if j is not None else None,
        }
        for n, (t, i, j) in enumerate(zip(texts, text_idx, links, strict=True))
    ]
    return {
        "image": {"width": int(size[0]), "height": int(size[1]), "name": name},
        "components": components,
        "texts": text_items,
        "thresholds": {"comp_conf": float(comp_conf), "text_conf": float(text_conf)},
        "source": "model",
    }


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
        # class ids follow the training order (alphabetical by name, as on the confusion-matrix axes)
        names: dict[int, str] = dict(self.detector.names)
        self.names = names
        text_cls = next((i for i, n in names.items() if n == "text"), None)
        if text_cls is None:
            raise ValueError("detector has no 'text' class")
        self.text_cls: int = text_cls
        self.processor = TrOCRProcessor.from_pretrained(str(reader))
        self.ocr = VisionEncoderDecoderModel.from_pretrained(str(reader)).to(self.device)
        self.ocr.eval()

    def read_texts(self, crops: list[np.ndarray], batch_size: int = 32) -> list[str]:
        """Read RGB crops with TrOCR, in batches; the strings are normalised with :func:`norm`."""
        import torch
        from PIL import Image

        dev_type = torch.device(self.device).type
        out: list[str] = []
        for i in range(0, len(crops), batch_size):
            images = [Image.fromarray(c) for c in crops[i : i + batch_size]]
            pv = self.processor(images=images, return_tensors="pt").pixel_values.to(self.device)
            with torch.no_grad(), torch.autocast(dev_type, dtype=torch.float16, enabled=dev_type == "cuda"):
                ids = self.ocr.generate(pv, max_new_tokens=16)
            out += [norm(t) for t in self.processor.batch_decode(ids, skip_special_tokens=True)]
        return out

    def _detect(
        self, bgr: np.ndarray, comp_conf: float, text_conf: float
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[str]]:
        """Detect on a BGR image and read the text boxes.

        Returns ``(cls_ids, confs, xyxy, texts)``: all detections above the lower of the two thresholds, and the
        strings read from the text boxes that pass ``text_conf`` (in detection order).
        """
        img = np.ascontiguousarray(bgr[..., ::-1])  # TrOCR crops in RGB
        yolo_device: str | int = 0 if self.device == "cuda" else self.device  # "cuda:N" passes through
        res = self.detector.predict(
            bgr, imgsz=self.imgsz, conf=min(comp_conf, text_conf), device=yolo_device, verbose=False
        )[0].boxes  # YOLO expects BGR arrays
        k = res.cls.cpu().numpy().astype(int)
        s = res.conf.cpu().numpy()
        xyxy = res.xyxy.cpu().numpy()
        tb = xyxy[text_mask(k, s, self.text_cls, text_conf)]
        texts = self.read_texts([crop(img, t) for t in tb]) if len(tb) else []
        return k, s, xyxy, texts

    def read(self, path: str | Path) -> tuple[list[tuple[str, np.ndarray]], list[dict[str, Any]]]:
        """Run the full pipeline on one image.

        Returns ``(components, texts)``: components are ``(class, box)``; each text is a dict with
        ``text, text_box, cls, comp_box, value`` (the last three are None if it was not attached).
        """
        import cv2

        bgr = cv2.imread(str(path))
        if bgr is None:
            raise FileNotFoundError(f"cannot read image: {path}")
        k, s, xyxy, texts = self._detect(bgr, self.comp_conf, self.text_conf)
        comps = [
            (self.names[int(c)], box)
            for c, sc, box in zip(k, s, xyxy, strict=True)
            if c != self.text_cls and sc >= self.comp_conf
        ]
        tb = xyxy[text_mask(k, s, self.text_cls, self.text_conf)]
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

    def read_image(
        self,
        bgr: np.ndarray,
        name: str = "image",
        comp_conf: float | None = None,
        text_conf: float | None = None,
    ) -> dict[str, Any]:
        """Run the full pipeline on a BGR image and return a JSON-ready result (see :func:`build_result`)."""
        cc = self.comp_conf if comp_conf is None else comp_conf
        tc = self.text_conf if text_conf is None else text_conf
        k, s, xyxy, texts = self._detect(bgr, cc, tc)
        h, w = bgr.shape[:2]
        return build_result(
            k, s, xyxy, texts, self.names, text_cls=self.text_cls, size=(w, h), name=name, comp_conf=cc, text_conf=tc
        )


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
