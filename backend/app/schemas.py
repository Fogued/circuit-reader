"""Pydantic models: the API contract shared with the frontend."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# x1, y1, x2, y2 in image pixels
Box = Annotated[tuple[float, float, float, float], Field(description="x1, y1, x2, y2 in image pixels")]

# The 17 component classes (text is the 18th detector class and is not listed), in the order of
# results/*_per_class_metrics.csv.
COMPONENT_CLASSES: tuple[str, ...] = (
    "V-DC (one port)",
    "GND",
    "Diode",
    "Capacitor",
    "Resistor",
    "Inductor",
    "MOSFET-P",
    "Wire Crossover",
    "BJT-PNP",
    "Zener Diode",
    "BJT-NPN",
    "I-DC",
    "MOSFET-N",
    "I-AC",
    "V-DC",
    "Op-Amp",
    "V-AC",
)


class Health(BaseModel):
    status: Literal["ok"] = "ok"
    mode: Literal["live", "demo"]
    classes: list[str]


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
