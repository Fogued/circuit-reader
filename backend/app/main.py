"""FastAPI app: ``uvicorn backend.app.main:app`` from the repository root."""

from __future__ import annotations

import csv
import io
import json
import os
from pathlib import Path
from typing import Annotated, Any

import numpy as np
from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps, UnidentifiedImageError

from .reader import ImageReader, get_reader
from .schemas import COMPONENT_CLASSES, Health, Metrics, ReadResult

REPO_ROOT = Path(__file__).resolve().parents[2]
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_TYPES = {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}

Reader = Annotated[ImageReader | None, Depends(get_reader)]
Conf = Annotated[float | None, Query(ge=0, le=1)]


def get_results_dir() -> Path:
    """Folder with the training results (override with env ``RESULTS_DIR``; default ``<repo>/results``)."""
    return Path(os.environ.get("RESULTS_DIR") or REPO_ROOT / "results")


def decode_image(data: bytes) -> np.ndarray:
    """Decode PNG/JPEG/WEBP bytes into an HxWx3 BGR uint8 array; raise HTTPException 400/415 on bad input."""
    if not data:
        raise HTTPException(400, "empty file")
    try:
        with Image.open(io.BytesIO(data)) as im:
            if im.format not in ALLOWED_TYPES.values():
                raise HTTPException(415, "unsupported image format; use PNG, JPEG or WEBP")
            rgb = np.asarray(ImageOps.exif_transpose(im).convert("RGB"))
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as e:
        raise HTTPException(400, "cannot decode image") from e
    return np.ascontiguousarray(rgb[..., ::-1])


def read_csv(path: Path) -> list[dict[str, Any]]:
    with path.open(newline="", encoding="utf-8") as f:
        return [
            {"class": r["class"], "n_gt": int(r["n_gt"]), **{k: float(r[k]) for k in ("P", "R", "AP50", "AP50-95")}}
            for r in csv.DictReader(f)
        ]


def create_app() -> FastAPI:
    app = FastAPI(title="circuit-reader API", version="1.0.0")
    origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["*"])

    @app.get("/api/health", response_model=Health)
    def health(reader: Reader) -> Health:
        return Health(mode="live" if reader is not None else "demo", classes=list(COMPONENT_CLASSES))

    @app.post("/api/read", response_model=ReadResult)
    def read(
        reader: Reader,
        file: Annotated[UploadFile, File()],
        comp_conf: Conf = None,
        text_conf: Conf = None,
    ) -> ReadResult:
        if reader is None:
            raise HTTPException(503, "model not loaded (demo mode)")
        if file.content_type not in ALLOWED_TYPES:
            raise HTTPException(415, "unsupported media type; use PNG, JPEG or WEBP")
        data = file.file.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "file too large (max 10 MB)")
        bgr = decode_image(data)
        result = reader.read_image(bgr, file.filename or "image", comp_conf=comp_conf, text_conf=text_conf)
        return ReadResult.model_validate(result)

    @app.get("/api/metrics", response_model=Metrics)
    def metrics(results: Annotated[Path, Depends(get_results_dir)]) -> dict[str, Any]:
        try:
            return {
                "detection": json.loads((results / "detection_summary.json").read_text(encoding="utf-8")),
                "values": json.loads((results / "values_summary.json").read_text(encoding="utf-8")),
                "per_class": {split: read_csv(results / f"{split}_per_class_metrics.csv") for split in ("val", "test")},
            }
        except FileNotFoundError as e:
            raise HTTPException(404, f"metrics file not found: {Path(str(e.filename)).name}") from e

    return app


app = create_app()
