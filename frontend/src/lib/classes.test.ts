import { describe, expect, it } from "vitest";
import { COMPONENT_CLASSES, TEXT_CLASS_ID, classColor } from "./classes";
import test from "../data/test_per_class_metrics.csv?raw";
import { parseClassCsv } from "./metrics";

describe("COMPONENT_CLASSES", () => {
  it("is the alphabetical detector order, 17 classes", () => {
    expect(COMPONENT_CLASSES).toHaveLength(17);
    expect([...COMPONENT_CLASSES]).toEqual([
      "BJT-NPN", "BJT-PNP", "Capacitor", "Diode", "GND", "I-AC", "I-DC", "Inductor", "MOSFET-N",
      "MOSFET-P", "Op-Amp", "Resistor", "V-AC", "V-DC", "V-DC (one port)", "Wire Crossover", "Zener Diode",
    ]);
    expect(TEXT_CLASS_ID).toBe(17);
  });
  it("covers the same classes as the metrics CSV (minus text)", () => {
    const names = parseClassCsv(test).map((r) => r.class).filter((c) => c !== "text");
    expect([...names].sort()).toEqual([...COMPONENT_CLASSES].sort());
  });
  it("gives every class a distinct colour", () => {
    expect(new Set(COMPONENT_CLASSES.map(classColor)).size).toBe(17);
  });
});
