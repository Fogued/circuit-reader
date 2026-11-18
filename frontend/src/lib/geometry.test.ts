import { describe, expect, it } from "vitest";
import { center, fitView, pairIds, zoomAt } from "./geometry";
import type { TextItem } from "../types";

describe("fitView", () => {
  it("fits and centres a wide image", () => {
    const v = fitView(500, 400, 800, 400, 0);
    expect(v.scale).toBeCloseTo(0.625);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(75);
  });
  it("survives empty containers", () => {
    expect(fitView(0, 0, 10, 10)).toEqual({ scale: 1, x: 0, y: 0 });
  });
});

describe("zoomAt", () => {
  it("keeps the anchor point fixed", () => {
    const v = { scale: 1, x: 10, y: 20 };
    const z = zoomAt(v, 2, 110, 120, 0.1, 10);
    expect((110 - z.x) / z.scale).toBeCloseTo((110 - v.x) / v.scale);
    expect((120 - z.y) / z.scale).toBeCloseTo((120 - v.y) / v.scale);
  });
  it("clamps the scale", () => {
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 100, 0, 0, 0.5, 4).scale).toBe(4);
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 0.001, 0, 0, 0.5, 4).scale).toBe(0.5);
  });
});

describe("pairIds", () => {
  const texts = [
    { id: "t0", component_id: "c0" },
    { id: "t1", component_id: "c0" },
    { id: "t2", component_id: null },
  ] as TextItem[];
  it("links a text to its component", () => expect([...pairIds("t0", texts)].sort()).toEqual(["c0", "t0"]));
  it("links a component to all its texts", () =>
    expect([...pairIds("c0", texts)].sort()).toEqual(["c0", "t0", "t1"]));
  it("handles unattached and null", () => {
    expect([...pairIds("t2", texts)]).toEqual(["t2"]);
    expect(pairIds(null, texts).size).toBe(0);
  });
  it("centres a box", () => expect(center([0, 10, 20, 30])).toEqual([10, 20]));
});
