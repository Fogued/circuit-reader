"""API tests: the reader is always a mock, no model is loaded."""

from __future__ import annotations

import csv
import io
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.main import MAX_UPLOAD_BYTES, create_app
from backend.app.reader import get_reader
from backend.app.schemas import COMPONENT_CLASSES

RESULTS = Path(__file__).resolve().parents[2] / "results"

FIXED_RESULT: dict[str, Any] = {
    "image": {"width": 40, "height": 30, "name": "x.png"},
    "components": [{"id": "c0", "cls": "Resistor", "box": [1, 2, 10, 12], "conf": 0.9}],
    "texts": [
        {"id": "t0", "text": "1k", "box": [12, 2, 20, 8], "conf": 0.8, "component_id": "c0", "value": "1kΩ"},
    ],
    "thresholds": {"comp_conf": 0.71, "text_conf": 0.59},
    "source": "model",
}


class FakeReader:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def read_image(
        self,
        bgr: np.ndarray,
        name: str = "image",
        comp_conf: float | None = None,
        text_conf: float | None = None,
    ) -> dict[str, Any]:
        self.calls.append(
            {"shape": bgr.shape, "pixel": bgr[0, 0].tolist(), "name": name, "cc": comp_conf, "tc": text_conf}
        )
        return FIXED_RESULT


def image_bytes(fmt: str = "PNG", size: tuple[int, int] = (40, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (255, 0, 0)).save(buf, format=fmt)
    return buf.getvalue()


@pytest.fixture
def fake() -> FakeReader:
    return FakeReader()


@pytest.fixture
def live(fake: FakeReader) -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_reader] = lambda: fake
    yield TestClient(app)


@pytest.fixture
def demo() -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_reader] = lambda: None
    yield TestClient(app)


def post(client: TestClient, data: bytes, content_type: str = "image/png", **params: float) -> Any:
    return client.post("/api/read", files={"file": ("x.png", data, content_type)}, params=params)


def test_health_demo(demo: TestClient) -> None:
    r = demo.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "mode": "demo", "classes": list(COMPONENT_CLASSES), "detail": None}


def test_health_live(live: TestClient) -> None:
    body = live.get("/api/health").json()
    assert body["mode"] == "live"
    assert len(body["classes"]) == 17


def test_classes_match_metrics_csv() -> None:
    with (RESULTS / "test_per_class_metrics.csv").open(encoding="utf-8") as f:
        names = [r["class"] for r in csv.DictReader(f) if r["class"] != "text"]
    # same set as the metrics; order is the detector's (alphabetical, see the training confusion matrix)
    assert sorted(names) == list(COMPONENT_CLASSES)


@pytest.mark.parametrize(("fmt", "mime"), [("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")])
def test_read_happy_path(live: TestClient, fake: FakeReader, fmt: str, mime: str) -> None:
    r = post(live, image_bytes(fmt), mime)
    assert r.status_code == 200
    assert r.json() == FIXED_RESULT
    call = fake.calls[0]
    assert call["shape"] == (30, 40, 3)
    assert call["name"] == "x.png"
    assert call["pixel"][2] > 200 > call["pixel"][0]  # red image arrives as BGR


def test_read_passes_thresholds(live: TestClient, fake: FakeReader) -> None:
    assert post(live, image_bytes(), comp_conf=0.5, text_conf=0).status_code == 200
    assert (fake.calls[0]["cc"], fake.calls[0]["tc"]) == (0.5, 0.0)


def test_read_defaults_thresholds_to_none(live: TestClient, fake: FakeReader) -> None:
    post(live, image_bytes())
    assert (fake.calls[0]["cc"], fake.calls[0]["tc"]) == (None, None)


def test_read_demo_mode_503(demo: TestClient) -> None:
    r = post(demo, image_bytes())
    assert r.status_code == 503
    assert r.json() == {"detail": "model not loaded (demo mode)"}


def test_wrong_content_type_415(live: TestClient) -> None:
    assert post(live, b"hello", "text/plain").status_code == 415


def test_real_format_not_allowed_415(live: TestClient) -> None:
    assert post(live, image_bytes("GIF"), "image/png").status_code == 415


def test_corrupted_image_400(live: TestClient) -> None:
    assert post(live, image_bytes()[:20] + b"garbage").status_code == 400
    assert post(live, b"not an image at all").status_code == 400


def test_empty_file_400(live: TestClient) -> None:
    assert post(live, b"").status_code == 400


def test_too_big_413(live: TestClient) -> None:
    assert post(live, b"\0" * (MAX_UPLOAD_BYTES + 1)).status_code == 413


def test_missing_file_422(live: TestClient) -> None:
    assert live.post("/api/read").status_code == 422


@pytest.mark.parametrize("params", [{"comp_conf": 1.5}, {"text_conf": -0.1}, {"comp_conf": "x"}])
def test_bad_thresholds_422(live: TestClient, params: dict[str, Any]) -> None:
    assert post(live, image_bytes(), **params).status_code == 422


def test_metrics_match_files(demo: TestClient) -> None:
    r = demo.get("/api/metrics")
    assert r.status_code == 200
    body = r.json()
    assert body["detection"]["test"]["components"]["mAP50"] == pytest.approx(0.9893, abs=5e-5)
    assert set(body["values"]) == {"val", "test"}
    test_rows = body["per_class"]["test"]
    assert len(test_rows) == 18 and len(body["per_class"]["val"]) == 18
    assert set(test_rows[0]) == {"class", "n_gt", "P", "R", "AP50", "AP50-95"}
    comps = [row["AP50"] for row in test_rows if row["class"] != "text"]
    assert sum(comps) / len(comps) == pytest.approx(body["detection"]["test"]["components"]["mAP50"], abs=1e-3)


def test_metrics_missing_files_404(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RESULTS_DIR", str(tmp_path))
    app = create_app()
    assert TestClient(app).get("/api/metrics").status_code == 404


def test_metrics_independent_of_cwd(demo: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    assert demo.get("/api/metrics").status_code == 200


def test_cors_origins_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "https://a.example, https://b.example")
    client = TestClient(create_app())
    r = client.get("/api/health", headers={"Origin": "https://b.example"})
    assert r.headers["access-control-allow-origin"] == "https://b.example"
    r = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers
