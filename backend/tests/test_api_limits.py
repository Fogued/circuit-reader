"""API tests for input limits, serialised reads, malformed results and startup loading (reader mocked)."""

from __future__ import annotations

import io
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.main import MAX_UPLOAD_BYTES, create_app

from .test_api import RESULTS, FakeReader, fake, image_bytes, live, post  # noqa: F401


def png_1bit(size: tuple[int, int]) -> bytes:
    buf = io.BytesIO()
    Image.new("1", size).save(buf, format="PNG")
    return buf.getvalue()


def test_huge_pixel_count_413(live: TestClient, fake: FakeReader) -> None:  # noqa: F811
    data = png_1bit((12000, 12000))
    assert len(data) < 1_000_000
    assert post(live, data).status_code == 413
    assert fake.calls == []


def test_max_side_413(live: TestClient) -> None:  # noqa: F811
    assert post(live, png_1bit((10_001, 10))).status_code == 413


def test_decompression_bomb_warning_413(live: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)  # 40x30 = 1200 > 1000 raises the warning
    assert post(live, image_bytes()).status_code == 413


def test_mpo_accepted_as_jpeg(live: TestClient, fake: FakeReader) -> None:  # noqa: F811
    buf = io.BytesIO()
    first = Image.new("RGB", (40, 30), (255, 0, 0))
    try:
        first.save(buf, format="MPO", save_all=True, append_images=[Image.new("RGB", (40, 30), (0, 255, 0))])
    except (KeyError, OSError, ValueError):
        pytest.skip("Pillow cannot write MPO")
    with Image.open(io.BytesIO(buf.getvalue())) as im:
        if im.format != "MPO":
            pytest.skip("Pillow did not produce an MPO file")
    assert post(live, buf.getvalue(), "image/jpeg").status_code == 200
    assert fake.calls[0]["shape"] == (30, 40, 3)


def test_content_length_rejected_early_413(live: TestClient, fake: FakeReader) -> None:  # noqa: F811
    r = live.post(
        "/api/read",
        content=b"x",
        headers={"content-type": "multipart/form-data; boundary=b", "content-length": str(MAX_UPLOAD_BYTES + 70_000)},
    )
    assert r.status_code == 413
    assert fake.calls == []


def test_reads_are_serialised(live: TestClient, fake: FakeReader) -> None:  # noqa: F811
    active = 0
    peak = 0
    guard = threading.Lock()
    original = fake.read_image

    def slow(*args: Any, **kwargs: Any) -> dict[str, Any]:
        nonlocal active, peak
        with guard:
            active += 1
            peak = max(peak, active)
        try:
            time.sleep(0.05)
            return original(*args, **kwargs)
        finally:
            with guard:
                active -= 1

    fake.read_image = slow  # type: ignore[method-assign]
    data = image_bytes()
    with ThreadPoolExecutor(4) as ex:
        codes = list(ex.map(lambda _: post(live, data).status_code, range(4)))
    assert codes == [200] * 4
    assert peak == 1


def copy_results(dst: Path) -> None:
    for f in RESULTS.iterdir():
        if f.is_file():
            (dst / f.name).write_bytes(f.read_bytes())


def test_metrics_malformed_json_500(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    copy_results(tmp_path)
    (tmp_path / "values_summary.json").write_text("{not json", encoding="utf-8")
    monkeypatch.setenv("RESULTS_DIR", str(tmp_path))
    r = TestClient(create_app()).get("/api/metrics")
    assert r.status_code == 500
    assert r.json()["detail"] == "results files unreadable: values_summary.json"


def test_metrics_malformed_csv_500(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    copy_results(tmp_path)
    (tmp_path / "test_per_class_metrics.csv").write_text("class,n_gt\nx,1\n", encoding="utf-8")
    monkeypatch.setenv("RESULTS_DIR", str(tmp_path))
    r = TestClient(create_app()).get("/api/metrics")
    assert r.status_code == 500
    assert r.json()["detail"] == "results files unreadable: test_per_class_metrics.csv"


def test_lifespan_loads_reader_once(fake: FakeReader, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    calls: list[int] = []

    def fake_load() -> FakeReader:
        calls.append(1)
        return fake

    monkeypatch.setattr("backend.app.main.load_reader", fake_load)
    with TestClient(create_app()) as client:
        assert client.get("/api/health").json()["mode"] == "live"
        assert post(client, image_bytes()).status_code == 200
        assert post(client, image_bytes()).status_code == 200
    assert calls == [1]


def test_lifespan_failure_falls_back_to_demo(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom() -> None:
        raise RuntimeError("bad weights")

    monkeypatch.setattr("backend.app.main.load_reader", boom)
    with TestClient(create_app()) as client:
        body = client.get("/api/health").json()
        assert body["mode"] == "demo"
        assert "bad weights" in body["detail"]
        assert post(client, image_bytes()).status_code == 503


def test_health_does_not_load(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom() -> None:
        raise AssertionError("must not load")

    monkeypatch.setattr("backend.app.main.load_reader", boom)
    # no lifespan is run here: nothing is loaded and health still answers
    assert TestClient(create_app()).get("/api/health").json()["mode"] == "demo"
