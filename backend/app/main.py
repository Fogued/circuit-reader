"""FastAPI app: ``uvicorn backend.app.main:app`` from the repository root."""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

import numpy as np
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .reader import ImageReader, get_reader, load_reader
from .schemas import COMPONENT_CLASSES, Health, Metrics, ReadResult

REPO_ROOT = Path(__file__).resolve().parents[2]
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MULTIPART_OVERHEAD = 64 * 1024
MAX_PIXELS = 25_000_000  # the detector resizes to 1024 px anyway
MAX_CONCURRENT_READS = 2
BUSY_WAIT_SECONDS = 0.1
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
        with Image.open(io.BytesIO(data)) as im:
            if im.format not in ALLOWED_FORMATS:
                raise HTTPException(415, "unsupported image format; use PNG, JPEG or WEBP")
            w, h = im.size  # known from the header, nothing is decoded yet
            if w * h > min(MAX_PIXELS, Image.MAX_IMAGE_PIXELS or MAX_PIXELS) or max(w, h) > MAX_SIDE:
                raise HTTPException(413, "image dimensions too large")
            rgb = np.asarray(ImageOps.exif_transpose(im).convert("RGB"))
    except HTTPException:
        raise
    except Image.DecompressionBombError as e:
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
    except Exception:
        log.exception("model loading failed, running in demo mode")
        app.state.load_error = True  # details stay in the server log, not in /api/health
    yield


class UploadSizeLimit:
    """Pure ASGI middleware: answer 413 as soon as the body of ``POST <path>`` exceeds ``limit`` bytes.

    Checks ``Content-Length`` up front and also counts the bytes actually received, so chunked uploads
    (no ``Content-Length``) are cut off too instead of being read to the end.
    """

    def __init__(self, app: ASGIApp, path: str, limit: int) -> None:
        self.app = app
        self.path = path
        self.limit = limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != self.path:
            await self.app(scope, receive, send)
            return
        length = dict(scope["headers"]).get(b"content-length", b"")
        if length.isdigit() and int(length) > self.limit:
            await self._reject(scope, receive, send)
            return

        received = 0
        started = False  # the app has begun its own response
        rejected = False  # we sent the 413
        over = False  # the body went over the limit

        async def counting_receive() -> Message:
            nonlocal received, rejected, over
            if over:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.limit:
                    # stop reading: the app sees a disconnect. Unless it already began a response, answer 413 right
                    # now; whatever it sends afterwards is dropped.
                    over = True
                    if not started:
                        rejected = True
                        await self._reject(scope, receive, send)
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal started
            if rejected:
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, guarded_send)
        except Exception:
            if not over:
                raise  # the app failed for its own reasons; after the cut-off its follow-up errors are noise

    @staticmethod
    async def _reject(scope: Scope, receive: Receive, send: Send) -> None:
        # connection: close makes the server drop the socket instead of draining the rest of the body
        response = JSONResponse(
            {"detail": "file too large (max 10 MB)"}, status_code=413, headers={"connection": "close"}
        )
        await response(scope, receive, send)


def create_app() -> FastAPI:
    app = FastAPI(title="circuit-reader API", version="1.0.0", lifespan=lifespan)
    read_lock = threading.Lock()
    slots = threading.BoundedSemaphore(int(os.environ.get("MAX_CONCURRENT_READS") or MAX_CONCURRENT_READS))

    app.add_middleware(UploadSizeLimit, path="/api/read", limit=MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD)
    origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["*"])

    @app.get("/api/health", response_model=Health)
    async def health(reader: Reader, request: Request) -> Health:
        return Health(
            mode="live" if reader is not None else "demo",
            classes=list(COMPONENT_CLASSES),
            detail="model failed to load; see server log" if getattr(request.app.state, "load_error", None) else None,
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
        if not slots.acquire(timeout=BUSY_WAIT_SECONDS):
            raise HTTPException(429, "server busy, retry")
        try:
            data = file.file.read(MAX_UPLOAD_BYTES + 1)
            if len(data) > MAX_UPLOAD_BYTES:
                raise HTTPException(413, "file too large (max 10 MB)")
            bgr = decode_image(data)
            with read_lock:
                result = reader.read_image(bgr, file.filename or "image", comp_conf=comp_conf, text_conf=text_conf)
        finally:
            slots.release()
        return ReadResult.model_validate(result)

    @app.get("/api/metrics", response_model=Metrics)
    async def metrics(results: Annotated[Path, Depends(get_results_dir)]) -> dict[str, Any]:
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
