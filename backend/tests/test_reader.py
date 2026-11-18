"""Class-order check: pure, no model is loaded."""

from __future__ import annotations

import pytest

from backend.app.reader import check_class_order
from backend.app.schemas import COMPONENT_CLASSES


def good() -> dict[int, str]:
    return {**dict(enumerate(COMPONENT_CLASSES)), 17: "text"}


def test_correct_order_passes() -> None:
    check_class_order(good())


def test_swapped_classes_rejected() -> None:
    names = good()
    names[0], names[1] = names[1], names[0]
    with pytest.raises(ValueError, match="class order"):
        check_class_order(names)


def test_text_not_last_rejected() -> None:
    names = good()
    names[17] = "Resistor"
    with pytest.raises(ValueError, match="class order"):
        check_class_order(names)


def test_missing_class_rejected() -> None:
    names = good()
    del names[5]
    with pytest.raises(ValueError, match="class order"):
        check_class_order(names)
