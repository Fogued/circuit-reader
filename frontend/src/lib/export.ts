import type { Box, ReadResult } from "../types";
import { COMPONENT_CLASSES, TEXT_CLASS_ID } from "./classes";

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const fmt = (x: number): string => clamp01(x).toFixed(6);

/** One YOLO label line: `cls xc yc w h`, all normalised to the image size. */
export function yoloLine(cls: number, box: Box, width: number, height: number): string {
  const x1 = Math.min(width, Math.max(0, box[0]));
  const y1 = Math.min(height, Math.max(0, box[1]));
  const x2 = Math.min(width, Math.max(0, box[2]));
  const y2 = Math.min(height, Math.max(0, box[3]));
  const xc = (x1 + x2) / 2 / width;
  const yc = (y1 + y2) / 2 / height;
  const w = (x2 - x1) / width;
  const h = (y2 - y1) / height;
  return `${cls} ${fmt(xc)} ${fmt(yc)} ${fmt(w)} ${fmt(h)}`;
}

/** Smallest box side kept after clipping, in pixels (same rule as the training notebook). */
export const MIN_COMPONENT_SIDE = 5;
export const MIN_TEXT_SIDE = 1;

export interface YoloExport {
  text: string;
  written: { components: number; texts: number };
  skipped: { components: number; texts: number; unknownClass: number; total: number };
}

const clip = (box: Box, width: number, height: number): Box => [
  Math.min(width, Math.max(0, box[0])),
  Math.min(height, Math.max(0, box[1])),
  Math.min(width, Math.max(0, box[2])),
  Math.min(height, Math.max(0, box[3])),
];

/**
 * YOLO label file: components (ids 0-16 in detector order) then text boxes (id 17).
 * After clipping to the image, degenerate boxes are dropped like in the notebook: components with a side
 * under 5 px and texts with a side of 1 px or less. Components with an unknown class are skipped too.
 */
export function buildYolo(result: ReadResult): YoloExport {
  const { width, height } = result.image;
  const lines: string[] = [];
  const out: YoloExport = {
    text: "",
    written: { components: 0, texts: 0 },
    skipped: { components: 0, texts: 0, unknownClass: 0, total: 0 },
  };
  for (const c of result.components) {
    const id = (COMPONENT_CLASSES as readonly string[]).indexOf(c.cls);
    const b = clip(c.box, width, height);
    if (id < 0) out.skipped.unknownClass++;
    else if (b[2] - b[0] < MIN_COMPONENT_SIDE || b[3] - b[1] < MIN_COMPONENT_SIDE) out.skipped.components++;
    else {
      lines.push(yoloLine(id, b, width, height));
      out.written.components++;
    }
  }
  for (const t of result.texts) {
    const b = clip(t.box, width, height);
    if (b[2] - b[0] <= MIN_TEXT_SIDE || b[3] - b[1] <= MIN_TEXT_SIDE) out.skipped.texts++;
    else {
      lines.push(yoloLine(TEXT_CLASS_ID, b, width, height));
      out.written.texts++;
    }
  }
  out.skipped.total = out.skipped.components + out.skipped.texts + out.skipped.unknownClass;
  out.text = lines.length ? lines.join("\n") + "\n" : "";
  return out;
}

export const toYolo = (result: ReadResult): string => buildYolo(result).text;

export function toJson(result: ReadResult): string {
  return JSON.stringify(result, null, 2) + "\n";
}

export function baseName(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "");
  return stem || "image";
}

export function download(filename: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
