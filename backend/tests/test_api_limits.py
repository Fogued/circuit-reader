"""API tests for input limits, serialised reads, malformed results and startup loading (reader mocked)."""

from __future__ import annotations

import asyncio
import io
import threading
import time
from collections.abc import MutableMapping
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.main import MAX_UPLOAD_BYTES, MULTIPART_OVERHEAD, UploadSizeLimit, create_app

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
    assert r.headers["connection"] == "close"
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
    with ThreadPoolExecutor(2) as ex:
        codes = list(ex.map(lambda _: post(live, data).status_code, range(2)))
    assert codes == [200] * 2
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
        assert body["detail"] == "model failed to load; see server log"
        assert "bad weights" not in str(body)
        assert post(client, image_bytes()).status_code == 503


def test_health_does_not_load(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom() -> None:
        raise AssertionError("must not load")

    monkeypatch.setattr("backend.app.main.load_reader", boom)
    # no lifespan is run here: nothing is loaded and health still answers
    assert TestClient(create_app()).get("/api/health").json()["mode"] == "demo"


def test_busy_returns_429(live: TestClient, fake: FakeReader) -> None:  # noqa: F811
    release = threading.Event()
    original = fake.read_image

    def blocked(*args: Any, **kwargs: Any) -> dict[str, Any]:
        release.wait(5)
        return original(*args, **kwargs)

    fake.read_image = blocked  # type: ignore[method-assign]
    data = image_bytes()
    with ThreadPoolExecutor(3) as ex:
        first = [ex.submit(post, live, data) for _ in range(2)]
        time.sleep(0.5)  # both slots are taken
        r = post(live, data)
        release.set()
        assert [f.result().status_code for f in first] == [200, 200]
    assert r.status_code == 429
    assert r.json() == {"detail": "server busy, retry"}


def test_health_and_metrics_are_coroutines() -> None:
    app = create_app()
    for path in ("/api/health", "/api/metrics"):
        route = next(r for r in app.routes if getattr(r, "path", None) == path)
        assert asyncio.iscoroutinefunction(route.endpoint)  # type: ignore[attr-defined]


PART_HEAD = b'--b\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n'


def test_chunked_upload_without_content_length_413(live: TestClient, fake: FakeReader) -> None:  # noqa: F811
    def body() -> Any:
        yield PART_HEAD
        for _ in range(20):
            yield b"\0" * (1 << 20)
        yield b"\r\n--b--\r\n"

    r = live.post(
        "/api/read",
        content=body(),
        headers={"content-type": "multipart/form-data; boundary=b", "origin": "http://localhost:5173"},
    )
    assert "content-length" not in r.request.headers
    assert r.status_code == 413
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert fake.calls == []


SCOPE = {"type": "http", "method": "POST", "path": "/api/read", "headers": [], "query_string": b""}


def test_upload_limit_stops_reading_early() -> None:
    limit = MULTIPART_OVERHEAD + MAX_UPLOAD_BYTES
    chunks_read = 0
    sent: list[MutableMapping[str, Any]] = []

    async def receive() -> MutableMapping[str, Any]:
        nonlocal chunks_read
        chunks_read += 1
        return {"type": "http.request", "body": b"\0" * (1 << 20), "more_body": True}

    async def send(message: MutableMapping[str, Any]) -> None:
        sent.append(message)

    async def inner(scope: Any, receive: Any, send: Any) -> None:
        while (await receive())["type"] != "http.disconnect":  # reads until the client stops
            pass

    asyncio.run(UploadSizeLimit(inner, "/api/read", limit)(SCOPE, receive, send))
    assert chunks_read <= limit // (1 << 20) + 1  # about 11 MiB, not "everything"
    assert [m["type"] for m in sent] == ["http.response.start", "http.response.body"]
    assert sent[0]["status"] == 413


def test_upload_limit_does_not_send_twice_after_response_started() -> None:
    sent: list[MutableMapping[str, Any]] = []

    async def receive() -> MutableMapping[str, Any]:
        return {"type": "http.request", "body": b"\0" * 100, "more_body": True}

    async def send(message: MutableMapping[str, Any]) -> None:
        sent.append(message)

    async def inner(scope: Any, receive: Any, send: Any) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": []})
        while (await receive())["type"] != "http.disconnect":
            pass

    asyncio.run(UploadSizeLimit(inner, "/api/read", 1000)(SCOPE, receive, send))
    assert [m["type"] for m in sent] == ["http.response.start"]
