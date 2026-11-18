import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, metrics, parseClassCsv, sortRows } from "./metrics";

describe("metrics", () => {
  it("parses the CSV rows", () => {
    const rows = parseClassCsv("class,n_gt,P,R,AP50,AP50-95\nGND,215,0.9,0.8,0.7,0.6\n");
    expect(rows).toEqual([{ class: "GND", n_gt: 215, P: 0.9, R: 0.8, AP50: 0.7, "AP50-95": 0.6 }]);
  });
  it("reads the bundled results", () => {
    expect(metrics.detection.test.components.mAP50).toBeCloseTo(0.989, 3);
    expect(metrics.perClass.test).toHaveLength(18);
    expect(metrics.perClass.val).toHaveLength(18);
    expect(metrics.values.test["end to end"]["found, read and attached"]).toBeCloseTo(0.903, 3);
  });
  it("uses the validation thresholds", () => {
    expect(DEFAULT_THRESHOLDS.comp_conf).toBeCloseTo(0.7057, 4);
    expect(DEFAULT_THRESHOLDS.text_conf).toBeCloseTo(0.5886, 4);
  });
  it("sorts both directions", () => {
    const rows = metrics.perClass.test;
    const asc = sortRows(rows, "AP50-95", "asc");
    const desc = sortRows(rows, "AP50-95", "desc");
    expect(asc[0]?.["AP50-95"]).toBeLessThan(desc[0]?.["AP50-95"] ?? 0);
    expect(sortRows(rows, "class", "asc")[0]?.class).toBe("BJT-NPN");
  });
});
