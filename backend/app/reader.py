"""Reader provider: the real ``CircuitReader`` when weights are configured, otherwise ``None`` (demo mode)."""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any, Protocol

import numpy as np
from fastapi import Request

from .schemas import COMPONENT_CLASSES


class ImageReader(Protocol):
    """What the API needs from a reader (``circuit_reader.CircuitReader`` satisfies it)."""

    def read_image(
        self,
        bgr: np.ndarray,
        name: str = "image",
        comp_conf: float | None = None,
        text_conf: float | None = None,
    ) -> dict[str, Any]: ...


def check_class_order(names: Mapping[int, str]) -> None:
    """Raise ValueError unless ids 0-16 are ``COMPONENT_CLASSES`` in order and id 17 is ``text``."""
    got = [names.get(i) for i in range(len(COMPONENT_CLASSES))]
    if got != list(COMPONENT_CLASSES) or names.get(len(COMPONENT_CLASSES)) != "text":
        raise ValueError(
            f"detector class order does not match the API contract: expected {list(COMPONENT_CLASSES)} "
            f"followed by 'text', got {dict(names)}"
        )


def load_reader() -> ImageReader | None:
    """Load the models from env ``CIRCUIT_DETECTOR`` (best.pt) and ``CIRCUIT_READER`` (trocr folder).

    Returns None when either variable is missing (demo mode). Raises if loading fails or the detector's
    class order is not the expected one.
    """
    detector, reader = os.environ.get("CIRCUIT_DETECTOR"), os.environ.get("CIRCUIT_READER")
    if not detector or not reader:
        return None
    from circuit_reader import CircuitReader  # heavy imports happen inside the constructor

    live = CircuitReader(detector, reader)
    check_class_order(live.names)
    return live


def get_reader(request: Request) -> ImageReader | None:
    """Dependency: the reader loaded at startup (None in demo mode); never loads anything itself."""
    reader: ImageReader | None = getattr(request.app.state, "reader", None)
    return reader
