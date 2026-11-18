"""Unit tests for the pure functions of circuit_reader (numpy and pytest only)."""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from circuit_reader import (  # noqa: E402
    DEFAULT_UNIT,
    UNIT_CLASSES,
    VALUE_CLASSES,
    box_gap,
    crop,
    iou_matrix,
    match_image,
    norm,
    unit_of,
    with_unit,
)

OHM = "\u03a9"  # Greek capital omega
OHM_SIGN = "Ω"  # ohm sign
MICRO_SIGN = "\u00b5"
MU = "\u03bc"

assert OHM != OHM_SIGN and MICRO_SIGN != MU  # a normalised source file would make these tests vacuous


def test_norm_removes_spaces() -> None:
    assert norm(" 1 k ") == "1k"


def test_norm_micro_sign_becomes_mu() -> None:
    assert norm("4.7" + MICRO_SIGN + "F") == "4.7" + MU + "F"


def test_norm_ohm_sign_becomes_omega() -> None:
    assert norm("1k" + OHM_SIGN) == "1k" + OHM


def test_norm_leaves_plain_text_alone() -> None:
    assert norm("10mH") == "10mH"
    assert norm("") == ""


@pytest.mark.parametrize("text", ["sin(2t)", "cos(wt)", "5 sin"])
def test_unit_of_sin_cos_is_ac(text: str) -> None:
    assert unit_of(text) == "AC"


def test_unit_of_hz_before_h() -> None:
    assert unit_of("2kHz") == "Hz"


def test_unit_of_millihenry() -> None:
    assert unit_of("10mH") == "H"


def test_unit_of_ohm_sign_input() -> None:
    assert unit_of("1k" + OHM_SIGN) == OHM
    assert unit_of("1k" + OHM) == OHM


@pytest.mark.parametrize(
    ("text", "unit"),
    [("10nF", "F"), ("12V", "V"), ("2A", "A"), ("5VA", "V"), ("1 0 V", "V")],
)
def test_unit_of_other_units(text: str, unit: str) -> None:
    assert unit_of(text) == unit


@pytest.mark.parametrize("text", ["1k", "R1", "", "10m"])
def test_unit_of_no_unit(text: str) -> None:
    assert unit_of(text) is None


def test_with_unit_adds_default_unit() -> None:
    assert with_unit("1k", "Resistor") == "1k" + OHM
    assert with_unit("10n", "Capacitor") == "10nF"
    assert with_unit("5m", "Inductor") == "5mH"
    assert with_unit("12", "V-DC") == "12V"
    assert with_unit("2", "I-DC") == "2A"


def test_with_unit_keeps_text_with_unit() -> None:
    assert with_unit("1k" + OHM, "Resistor") == "1k" + OHM
    assert with_unit("10V", "Resistor") == "10V"


def test_with_unit_class_without_default() -> None:
    assert with_unit("1k", "GND") == "1k"
    assert with_unit("5", "V-AC") == "5"


def test_box_gap_touching_is_zero() -> None:
    assert box_gap((0, 0, 10, 10), (10, 0, 20, 10)) == 0.0
    assert box_gap((0, 0, 10, 10), (0, 10, 10, 20)) == 0.0


def test_box_gap_overlapping_is_zero() -> None:
    assert box_gap((0, 0, 10, 10), (5, 5, 15, 15)) == 0.0


def test_box_gap_horizontal_and_vertical() -> None:
    assert box_gap((0, 0, 10, 10), (15, 0, 20, 10)) == 5.0
    assert box_gap((0, 0, 10, 10), (0, 30, 10, 40)) == 20.0


def test_box_gap_diagonal_is_hypot() -> None:
    assert box_gap((0, 0, 10, 10), (13, 14, 20, 20)) == math.hypot(3, 4)
    assert box_gap((13, 14, 20, 20), (0, 0, 10, 10)) == 5.0


def test_match_image_unit_restricts_class() -> None:
    comps = [("Capacitor", (0, 0, 10, 10)), ("Resistor", (100, 0, 110, 10))]
    # the capacitor is much closer, but the text has an ohm unit
    assert match_image([("1k" + OHM, (12, 0, 20, 10))], comps) == [1]
    # without the unit rule the nearest value class wins
    assert match_image([("1k" + OHM, (12, 0, 20, 10))], comps, use_units=False) == [0]


def test_match_image_no_unit_goes_to_nearest_value_class() -> None:
    comps = [("Resistor", (0, 0, 10, 10)), ("Inductor", (50, 0, 60, 10))]
    assert match_image([("10", (45, 0, 48, 10))], comps) == [1]
    assert match_image([("10", (11, 0, 14, 10))], comps) == [0]


def test_match_image_non_value_classes_never_chosen() -> None:
    comps = [("GND", (0, 0, 10, 10)), ("Diode", (12, 0, 20, 10)), ("Resistor", (200, 0, 210, 10))]
    assert match_image([("5", (11, 0, 12, 10))], comps) == [2]
    assert match_image([("5", (11, 0, 12, 10))], comps[:2]) == [None]


def test_match_image_no_candidate_is_none() -> None:
    assert match_image([("1k" + OHM, (0, 0, 5, 5))], []) == [None]
    assert match_image([("1k" + OHM, (0, 0, 5, 5))], [("Capacitor", (0, 0, 5, 5))]) == [None]
    assert match_image([], [("Resistor", (0, 0, 5, 5))]) == []


def test_match_image_ties_go_to_lower_index() -> None:
    comps = [("Resistor", (0, 0, 10, 10)), ("Resistor", (30, 0, 40, 10))]
    assert match_image([("5", (15, 0, 25, 10))], comps) == [0]


def test_match_image_multiple_texts() -> None:
    comps = [("Resistor", (0, 0, 10, 10)), ("Capacitor", (100, 0, 110, 10))]
    texts = [("1k", (12, 0, 20, 10)), ("10nF", (90, 0, 98, 10))]
    assert match_image(texts, comps) == [0, 1]


def test_match_image_accepts_numpy_boxes() -> None:
    comps = [("Resistor", np.array([0.0, 0.0, 10.0, 10.0]))]
    assert match_image([("1k", np.array([12.0, 0.0, 20.0, 10.0]))], comps) == [0]


def test_constants_are_consistent() -> None:
    assert VALUE_CLASSES == {"V-AC", "I-AC", "Resistor", "Capacitor", "Inductor", "V-DC", "V-DC (one port)", "I-DC"}
    assert set(DEFAULT_UNIT) <= VALUE_CLASSES
    assert set(UNIT_CLASSES) == {"AC", "Hz", OHM, "F", "H", "V", "A"}


def test_iou_identical_is_one() -> None:
    m = iou_matrix([(0, 0, 10, 10)], [(0, 0, 10, 10)])
    assert m.shape == (1, 1)
    assert m[0, 0] == pytest.approx(1.0)


def test_iou_disjoint_is_zero() -> None:
    assert iou_matrix([(0, 0, 10, 10)], [(20, 20, 30, 30)])[0, 0] == 0.0


def test_iou_partial_overlap() -> None:
    # intersection 5x10 = 50, union 100 + 100 - 50 = 150
    assert iou_matrix([(0, 0, 10, 10)], [(5, 0, 15, 10)])[0, 0] == pytest.approx(1 / 3)


def test_iou_matrix_shape() -> None:
    a = [(0, 0, 10, 10), (0, 0, 5, 5), (20, 20, 30, 30)]
    b = [(0, 0, 10, 10), (5, 5, 10, 10)]
    assert iou_matrix(a, b).shape == (3, 2)


def test_iou_empty_inputs() -> None:
    assert iou_matrix([], [(0, 0, 1, 1)]).shape == (0, 1)
    assert iou_matrix([(0, 0, 1, 1)], []).shape == (1, 0)
    assert iou_matrix([], []).shape == (0, 0)
    assert iou_matrix(np.empty((0, 4)), np.empty((0, 4))).shape == (0, 0)


def _image() -> np.ndarray:
    return np.arange(100 * 200 * 3, dtype=np.int64).reshape(100, 200, 3)  # H=100, W=200


def test_crop_adds_padding() -> None:
    img = _image()
    out = crop(img, (50, 40, 70, 60))
    assert out.shape == (28, 28, 3)  # rows 36..64, cols 46..74
    assert np.array_equal(out, img[36:64, 46:74])


def test_crop_clips_at_borders() -> None:
    img = _image()
    assert crop(img, (0, 0, 10, 10)).shape == (14, 14, 3)  # rows 0..14, cols 0..14
    assert crop(img, (190, 90, 200, 100)).shape == (14, 14, 3)  # rows 86..100, cols 186..200
    assert crop(img, (-20, -20, 300, 300)).shape == (100, 200, 3)


def test_crop_rounds_float_box_and_custom_pad() -> None:
    img = _image()
    out = crop(img, (10.4, 10.6, 20.5, 20.2), pad=0)
    # x1=10, y1=11, x2=round(20.5)=20 (banker's rounding), y2=20
    assert out.shape == (9, 10, 3)


def test_crop_returns_a_copy() -> None:
    img = _image()
    out = crop(img, (10, 10, 20, 20))
    out[:] = -1
    assert img.min() >= 0
