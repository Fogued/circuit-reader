// Copies the bundled metrics files from ../results into src/data so the Metrics tab works without a backend.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "src", "data");
mkdirSync(out, { recursive: true });
for (const f of [
  "detection_summary.json",
  "values_summary.json",
  "val_per_class_metrics.csv",
  "test_per_class_metrics.csv",
]) {
  copyFileSync(join(root, "..", "results", f), join(out, f));
}
