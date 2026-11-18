"""Pydantic models: the API contract shared with the frontend."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# x1, y1, x2, y2 in image pixels
Box = Annotated[tuple[float, float, float, float], Field(description="x1, y1, x2, y2 in image pixels")]

# The 17 component classes in detector order: ids 0-16 follow the training order (alphabetical by name, as
# shown on the confusion-matrix axes of results/figures/test_confusion_matrix.png). "text" is detector
# class 17 and is not listed.
COMPONENT_CLASSES: tuple[str, ...] = (
    "BJT-NPN",
    "BJT-PNP",
    "Capacitor",
    "Diode",
    "GND",
    "I-AC",
    "I-DC",
    "Inductor",
    "MOSFET-N",
    "MOSFET-P",
    "Op-Amp",
    "Resistor",
    "V-AC",
    "V-DC",
    "V-DC (one port)",
    "Wire Crossover",
    "Zener Diode",
)


class Health(BaseModel):
    status: Literal["ok"] = "ok"
    mode: Literal["live", "demo"]
    classes: list[str]
    detail: str | None = None


class ImageInfo(BaseModel):
    width: int
    height: int
    name: str


class Component(BaseModel):
    id: str
    cls: str
    box: Box
    conf: float


class TextItem(BaseModel):
    id: str
    text: str
    box: Box
    conf: float
    component_id: str | None
    value: str | None


class Thresholds(BaseModel):
    comp_conf: float
    text_conf: float


class ReadResult(BaseModel):
    image: ImageInfo
    components: list[Component]
    texts: list[TextItem]
    thresholds: Thresholds
    source: Literal["model", "synthetic-fixture"]


class MetricsRow(BaseModel):
    """One line of ``results/*_per_class_metrics.csv``."""

    model_config = ConfigDict(populate_by_name=True)

    class_: str = Field(alias="class")
    n_gt: int
    P: float
    R: float
    AP50: float
    AP50_95: float = Field(alias="AP50-95")


class PerClassMetrics(BaseModel):
    val: list[MetricsRow]
    test: list[MetricsRow]


class Metrics(BaseModel):
    detection: dict[str, Any]
    values: dict[str, Any]
    per_class: PerClassMetrics
