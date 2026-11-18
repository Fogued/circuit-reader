"""Reader provider: the real ``CircuitReader`` when weights are configured, otherwise ``None`` (demo mode)."""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any, Protocol

import numpy as np


class ImageReader(Protocol):
    """What the API needs from a reader (``circuit_reader.CircuitReader`` satisfies it)."""

    def read_image(
        self,
        bgr: np.ndarray,
        name: str = "image",
        comp_conf: float | None = None,
        text_conf: float | None = None,
    ) -> dict[str, Any]: ...


@lru_cache(maxsize=1)
def get_reader() -> ImageReader | None:
    """Load the models once, from env ``CIRCUIT_DETECTOR`` (best.pt) and ``CIRCUIT_READER`` (trocr folder).

    Returns None when either variable is missing: the app then runs in demo mode.
    """
    detector, reader = os.environ.get("CIRCUIT_DETECTOR"), os.environ.get("CIRCUIT_READER")
    if not detector or not reader:
        return None
    from circuit_reader import CircuitReader  # heavy imports happen inside the constructor

    return CircuitReader(detector, reader)
