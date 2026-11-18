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

/** YOLO label file: components (ids 0-16 in detector order) then text boxes (id 17). */
export function toYolo(result: ReadResult): string {
  const { width, height } = result.image;
  const lines: string[] = [];
  for (const c of result.components) {
    const id = (COMPONENT_CLASSES as readonly string[]).indexOf(c.cls);
    if (id >= 0) lines.push(yoloLine(id, c.box, width, height));
  }
  for (const t of result.texts) lines.push(yoloLine(TEXT_CLASS_ID, t.box, width, height));
  return lines.length ? lines.join("\n") + "\n" : "";
}

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
