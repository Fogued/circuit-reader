"""FastAPI app: ``uvicorn backend.app.main:app`` from the repository root."""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import threading
import warnings
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

import numpy as np
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError

from .reader import ImageReader, get_reader, load_reader
from .schemas import COMPONENT_CLASSES, Health, Metrics, ReadResult

REPO_ROOT = Path(__file__).resolve().parents[2]
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MULTIPART_OVERHEAD = 64 * 1024
MAX_PIXELS = 40_000_000
MAX_SIDE = 10_000
ALLOWED_TYPES = {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}
# Pillow reports multi-picture phone JPEGs as MPO
ALLOWED_FORMATS = {*ALLOWED_TYPES.values(), "MPO"}

log = logging.getLogger("circuit_reader.api")

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
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as im:
                if im.format not in ALLOWED_FORMATS:
                    raise HTTPException(415, "unsupported image format; use PNG, JPEG or WEBP")
                w, h = im.size
                if w * h > MAX_PIXELS or max(w, h) > MAX_SIDE:
                    raise HTTPException(413, "image dimensions too large")
                rgb = np.asarray(ImageOps.exif_transpose(im).convert("RGB"))
    except HTTPException:
        raise
    except (Image.DecompressionBombWarning, Image.DecompressionBombError) as e:
        raise HTTPException(413, "image dimensions too large") from e
    except (UnidentifiedImageError, OSError, ValueError) as e:
        raise HTTPException(400, "cannot decode image") from e
    return np.ascontiguousarray(rgb[..., ::-1])


def read_csv(path: Path) -> list[dict[str, Any]]:
    with path.open(newline="", encoding="utf-8") as f:
        return [
            {"class": r["class"], "n_gt": int(r["n_gt"]), **{k: float(r[k]) for k in ("P", "R", "AP50", "AP50-95")}}
            for r in csv.DictReader(f)
        ]


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Load the reader once at startup; on failure log it and run in demo mode."""
    app.state.reader = None
    app.state.load_error = None
    try:
        app.state.reader = load_reader()
    except Exception as e:
        log.exception("model loading failed, running in demo mode")
        app.state.load_error = f"{type(e).__name__}: {e}"
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="circuit-reader API", version="1.0.0", lifespan=lifespan)
    read_lock = threading.Lock()

    @app.middleware("http")
    async def limit_read_size(request: Request, call_next: Any) -> Any:
        if request.method == "POST" and request.url.path == "/api/read":
            length = request.headers.get("content-length", "")
            if length.isdigit() and int(length) > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD:
                return JSONResponse({"detail": "file too large (max 10 MB)"}, status_code=413)
        return await call_next(request)

    origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["*"])

    @app.get("/api/health", response_model=Health)
    def health(reader: Reader, request: Request) -> Health:
        return Health(
            mode="live" if reader is not None else "demo",
            classes=list(COMPONENT_CLASSES),
            detail=getattr(request.app.state, "load_error", None),
        )

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
        with read_lock:
            result = reader.read_image(bgr, file.filename or "image", comp_conf=comp_conf, text_conf=text_conf)
        return ReadResult.model_validate(result)

    @app.get("/api/metrics", response_model=Metrics)
    def metrics(results: Annotated[Path, Depends(get_results_dir)]) -> dict[str, Any]:
        current = ""
        try:
            out: dict[str, Any] = {}
            current = "detection_summary.json"
            out["detection"] = json.loads((results / current).read_text(encoding="utf-8"))
            current = "values_summary.json"
            out["values"] = json.loads((results / current).read_text(encoding="utf-8"))
            out["per_class"] = {}
            for split in ("val", "test"):
                current = f"{split}_per_class_metrics.csv"
                out["per_class"][split] = read_csv(results / current)
            return out
        except FileNotFoundError as e:
            raise HTTPException(404, f"metrics file not found: {Path(str(e.filename)).name}") from e
        except (json.JSONDecodeError, KeyError, ValueError, OSError) as e:
            raise HTTPException(500, f"results files unreadable: {current}") from e

    return app


app = create_app()
