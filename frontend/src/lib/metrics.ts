import detection from "../data/detection_summary.json";
import values from "../data/values_summary.json";
import valCsv from "../data/val_per_class_metrics.csv?raw";
import testCsv from "../data/test_per_class_metrics.csv?raw";
import type { ClassRow } from "../types";

export type Split = "val" | "test";

export function parseClassCsv(csv: string): ClassRow[] {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  const cols = (header ?? "").split(",");
  return lines
    .filter((l) => l.trim() !== "")
    .map((line) => {
      const cells = line.split(",");
      const o: Record<string, string> = {};
      cols.forEach((c, i) => (o[c] = cells[i] ?? ""));
      return {
        class: o["class"] ?? "",
        n_gt: Number(o["n_gt"]),
        P: Number(o["P"]),
        R: Number(o["R"]),
        AP50: Number(o["AP50"]),
        "AP50-95": Number(o["AP50-95"]),
      };
    });
}

export const metrics = {
  detection,
  values,
  perClass: { val: parseClassCsv(valCsv), test: parseClassCsv(testCsv) },
};

/** Default confidence thresholds: the validation-optimal values stored with the detection results. */
export const DEFAULT_THRESHOLDS = {
  comp_conf: detection.val.components.conf,
  text_conf: detection.val.text.conf,
};

export function sortRows(rows: ClassRow[], key: keyof ClassRow, dir: "asc" | "desc"): ClassRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    const c = typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : Number(x) - Number(y);
    return sign * c;
  });
}

export const pct = (x: number, digits = 1): string => `${(x * 100).toFixed(digits)}%`;
export const num = (x: number, digits = 3): string => x.toFixed(digits);
