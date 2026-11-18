import { describe, expect, it } from "vitest";
import { baseName, toJson, toYolo, yoloLine } from "./export";
import type { ReadResult } from "../types";

const result: ReadResult = {
  image: { width: 200, height: 100, name: "a.png" },
  components: [
    { id: "c0", cls: "Resistor", box: [20, 10, 60, 50], conf: 0.9 },
    { id: "c1", cls: "BJT-NPN", box: [100, 0, 200, 100], conf: 0.8 },
  ],
  texts: [{ id: "t0", text: "1k", box: [20, 60, 60, 80], conf: 0.7, component_id: "c0", value: "1kΩ" }],
  thresholds: { comp_conf: 0.5, text_conf: 0.5 },
  source: "synthetic-fixture",
};

describe("export", () => {
  it("normalises a box", () => {
    expect(yoloLine(3, [0, 0, 100, 50], 200, 100)).toBe("3 0.250000 0.250000 0.500000 0.500000");
  });
  it("clamps out-of-range boxes", () => {
    expect(yoloLine(0, [-10, 0, 300, 100], 200, 100)).toBe("0 0.500000 0.500000 1.000000 1.000000");
  });
  it("writes components in detector order then text as class 17", () => {
    const lines = toYolo(result).trimEnd().split("\n");
    expect(lines).toEqual([
      "11 0.200000 0.300000 0.200000 0.400000",
      "0 0.750000 0.500000 0.500000 1.000000",
      "17 0.200000 0.700000 0.200000 0.200000",
    ]);
  });
  it("is empty without detections", () => {
    expect(toYolo({ ...result, components: [], texts: [] })).toBe("");
  });
  it("round-trips JSON", () => {
    expect(JSON.parse(toJson(result))).toEqual(result);
  });
  it("derives a base name", () => {
    expect(baseName("circuit_1.final.jpg")).toBe("circuit_1.final");
    expect(baseName("noext")).toBe("noext");
  });
});
