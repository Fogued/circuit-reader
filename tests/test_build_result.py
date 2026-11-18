"""Tests for build_result / text_mask (numpy and pytest only, no torch)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from circuit_reader import DEFAULT_COMP_CONF, DEFAULT_TEXT_CONF, build_result, text_mask  # noqa: E402

NAMES = {0: "Resistor", 1: "Capacitor", 2: "V-DC", 3: "text"}
TEXT = 3
# detections: resistor, capacitor, low-conf resistor, text near resistor, text near capacitor, low-conf text
CLS = np.array([0, 1, 0, 3, 3, 3])
CONF = np.array([0.9, 0.8, 0.3, 0.7, 0.65, 0.2])
XYXY = np.array(
    [
        [0, 0, 10, 10],
        [100, 0, 110, 10],
        [50, 50, 60, 60],
        [12, 0, 20, 10],
        [112, 0, 120, 10],
        [50, 0, 55, 5],
    ],
    dtype=float,
)


def result(texts: list[str]) -> dict:
    return build_result(CLS, CONF, XYXY, texts, NAMES, text_cls=TEXT, size=(200, 100), name="a.png")


def test_text_mask() -> None:
    assert text_mask(CLS, CONF, TEXT, 0.59).tolist() == [False, False, False, True, True, False]


def test_ids_filtering_and_links() -> None:
    r = result(["1k", "10u"])
    assert [c["id"] for c in r["components"]] == ["c0", "c1"]  # the 0.3 resistor is below 0.71
    assert [c["cls"] for c in r["components"]] == ["Resistor", "Capacitor"]
    assert [t["id"] for t in r["texts"]] == ["t0", "t1"]
    assert [t["component_id"] for t in r["texts"]] == ["c0", "c1"]
    assert [t["conf"] for t in r["texts"]] == [0.7, 0.65]
    assert r["texts"][0]["box"] == [12.0, 0.0, 20.0, 10.0]


def test_value_uses_with_unit() -> None:
    r = result(["1k", "10uF"])
    assert r["texts"][0]["value"] == "1kΩ"  # bare number next to a resistor
    assert r["texts"][1]["value"] == "10uF"  # already has a unit


def test_unit_restricts_the_link() -> None:
    # "5V" can only go to a voltage source; none is detected, so it stays unattached
    r = result(["5V", "1k"])
    assert r["texts"][0]["component_id"] is None
    assert r["texts"][0]["value"] is None


def test_metadata_and_json_serialisable() -> None:
    r = result(["1k", "2n"])
    assert r["image"] == {"width": 200, "height": 100, "name": "a.png"}
    assert r["thresholds"] == {"comp_conf": DEFAULT_COMP_CONF, "text_conf": DEFAULT_TEXT_CONF}
    assert r["source"] == "model"
    json.dumps(r)  # plain Python types only


def test_custom_thresholds() -> None:
    r = build_result(CLS, CONF, XYXY, ["a", "b", "c"], NAMES, text_cls=TEXT, size=(1, 1), comp_conf=0.2, text_conf=0.1)
    assert len(r["components"]) == 3 and len(r["texts"]) == 3


def test_no_detections() -> None:
    r = build_result([], [], np.empty((0, 4)), [], NAMES, text_cls=TEXT, size=(5, 5))
    assert r["components"] == [] and r["texts"] == []


def test_text_count_mismatch() -> None:
    with pytest.raises(ValueError, match="expected 2 texts"):
        result(["only one"])
