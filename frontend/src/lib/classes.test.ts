import { describe, expect, it } from "vitest";
import { COMPONENT_CLASSES, FAMILIES, TEXT_CLASS_ID, classColor, familyOf } from "./classes";
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
  it("puts every class in exactly one family, five families", () => {
    expect(FAMILIES).toHaveLength(5);
    const members = FAMILIES.flatMap((f) => [...f.members]);
    expect([...members].sort()).toEqual([...COMPONENT_CLASSES].sort());
    expect(new Set(members).size).toBe(17);
  });
  it("colours by family", () => {
    expect(classColor("Resistor")).toBe(classColor("Inductor"));
    expect(classColor("Resistor")).not.toBe(classColor("GND"));
    expect(familyOf("MOSFET-N").name).toBe("Semiconductors");
  });
});
