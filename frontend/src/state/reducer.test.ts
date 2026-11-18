import { describe, expect, it } from "vitest";
import { canRedo, canUndo, initialState, needsReview, reducer, toResult, type Action, type ReviewState } from "./reducer";
import type { ReadResult } from "../types";

const OHM = "Ω";

const base: ReadResult = {
  image: { width: 100, height: 100, name: "x.png" },
  components: [
    { id: "c0", cls: "Resistor", box: [0, 0, 10, 10], conf: 0.9 },
    { id: "c1", cls: "Capacitor", box: [50, 0, 60, 10], conf: 0.4 },
  ],
  texts: [
    { id: "t0", text: "1k", box: [0, 20, 10, 30], conf: 0.8, component_id: "c0", value: `1k${OHM}` },
    { id: "t1", text: "10n", box: [50, 20, 60, 30], conf: 0.3, component_id: "c1", value: "10nF" },
  ],
  thresholds: { comp_conf: 0.5, text_conf: 0.5 },
  source: "synthetic-fixture",
};

const run = (...actions: Action[]): ReviewState =>
  actions.reduce(reducer, reducer(initialState, { type: "load", result: base }));

describe("reducer", () => {
  it("ignores actions before a result is loaded", () => {
    expect(reducer(initialState, { type: "undo" })).toBe(initialState);
    expect(reducer(initialState, { type: "deleteText", id: "t0" })).toBe(initialState);
  });

  it("changing the class recomputes attached values", () => {
    const s = run({ type: "setClass", id: "c0", cls: "Inductor" });
    expect(s.doc?.components[0]?.cls).toBe("Inductor");
    expect(s.doc?.texts[0]?.value).toBe("1kH");
  });

  it("editing text recomputes the value with the unit rules", () => {
    const s = run({ type: "editText", id: "t0", text: "4.7k" });
    expect(s.doc?.texts[0]).toMatchObject({ text: "4.7k", value: `4.7k${OHM}` });
    const s2 = run({ type: "editText", id: "t0", text: "5V" });
    expect(s2.doc?.texts[0]?.value).toBe("5V");
  });

  it("stores the normalised text, like the model output", () => {
    const s = run({ type: "editText", id: "t0", text: " 4.7 kΩ " });
    expect(s.doc?.texts[0]).toMatchObject({ text: "4.7kΩ", value: "4.7kΩ" });
    const mu = run({ type: "editText", id: "t0", text: "10µF" });
    expect(mu.doc?.texts[0]?.text).toBe("10μF");
  });

  it("reassigning recomputes the value; null clears it", () => {
    const s = run({ type: "reassign", id: "t0", componentId: "c1" });
    expect(s.doc?.texts[0]).toMatchObject({ component_id: "c1", value: "1kF" });
    const s2 = run({ type: "reassign", id: "t0", componentId: null });
    expect(s2.doc?.texts[0]).toMatchObject({ component_id: null, value: null });
  });

  it("rejects reassignment to an unknown component", () => {
    const before = run();
    expect(reducer(before, { type: "reassign", id: "t0", componentId: "nope" })).toBe(before);
  });

  it("deleting a component detaches its texts", () => {
    const s = run({ type: "deleteComponent", id: "c0" });
    expect(s.doc?.components.map((c) => c.id)).toEqual(["c1"]);
    expect(s.doc?.texts[0]).toMatchObject({ component_id: null, value: null });
  });

  it("deleting a text removes it and its reviewed mark", () => {
    const s = run({ type: "toggleReviewed", id: "t1" }, { type: "deleteText", id: "t1" });
    expect(s.doc?.texts.map((t) => t.id)).toEqual(["t0"]);
    expect(s.doc?.reviewed).toEqual([]);
  });

  it("toggles reviewed", () => {
    const s = run({ type: "toggleReviewed", id: "c1" });
    expect(s.doc?.reviewed).toEqual(["c1"]);
    expect(reducer(s, { type: "toggleReviewed", id: "c1" }).doc?.reviewed).toEqual([]);
  });

  it("no-op edits do not create history", () => {
    const s = run({ type: "setClass", id: "c0", cls: "Resistor" }, { type: "editText", id: "t0", text: "1k" });
    expect(canUndo(s)).toBe(false);
  });

  it("undo and redo walk the history; a new edit clears redo", () => {
    let s = run({ type: "editText", id: "t0", text: "2k" }, { type: "deleteText", id: "t1" });
    expect(s.doc?.texts).toHaveLength(1);
    s = reducer(s, { type: "undo" });
    expect(s.doc?.texts).toHaveLength(2);
    expect(canRedo(s)).toBe(true);
    s = reducer(s, { type: "undo" });
    expect(s.doc?.texts[0]?.text).toBe("1k");
    expect(canUndo(s)).toBe(false);
    s = reducer(s, { type: "redo" });
    expect(s.doc?.texts[0]?.text).toBe("2k");
    s = reducer(s, { type: "setClass", id: "c1", cls: "Diode" });
    expect(canRedo(s)).toBe(false);
  });

  it("reset restores the original and can be undone", () => {
    let s = run({ type: "deleteText", id: "t0" }, { type: "reset" });
    expect(s.doc?.texts).toHaveLength(2);
    s = reducer(s, { type: "undo" });
    expect(s.doc?.texts).toHaveLength(1);
  });

  it("needsReview depends on confidence and reviewed state", () => {
    const s = run({ type: "toggleReviewed", id: "c1" });
    expect(needsReview(0.4, "c1", run().doc as never, 0.6)).toBe(true);
    expect(needsReview(0.4, "c1", s.doc as never, 0.6)).toBe(false);
    expect(needsReview(0.9, "c0", s.doc as never, 0.6)).toBe(false);
  });

  it("toResult applies thresholds and detaches texts from dropped components", () => {
    const s = run();
    const r = toResult(s, { comp_conf: 0.5, text_conf: 0.1 });
    expect(r?.components.map((c) => c.id)).toEqual(["c0"]);
    expect(r?.texts[1]).toMatchObject({ component_id: null, value: null });
    expect(r?.thresholds).toEqual({ comp_conf: 0.5, text_conf: 0.1 });
    expect(toResult(initialState, base.thresholds)).toBeNull();
  });
});
