import type { Box, TextItem } from "../types";

/** Screen transform of the image stage: screen = image * scale + (x, y). */
export interface View {
  scale: number;
  x: number;
  y: number;
}

/** Scale and offset that fit and centre an image inside a container. */
export function fitView(cw: number, ch: number, iw: number, ih: number, pad = 12): View {
  if (cw <= 0 || ch <= 0 || iw <= 0 || ih <= 0) return { scale: 1, x: 0, y: 0 };
  const scale = Math.min((cw - 2 * pad) / iw, (ch - 2 * pad) / ih);
  const s = Math.max(scale, 0.01);
  return { scale: s, x: (cw - iw * s) / 2, y: (ch - ih * s) / 2 };
}

/** Zoom by `factor` keeping the screen point (px, py) fixed; the scale stays within [min, max]. */
export function zoomAt(v: View, factor: number, px: number, py: number, min: number, max: number): View {
  const scale = Math.min(max, Math.max(min, v.scale * factor));
  const k = scale / v.scale;
  return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
}

export const center = (b: Box): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

/** The item and its counterpart(s): a text with its component, a component with all its texts. */
export function pairIds(id: string | null, texts: TextItem[]): Set<string> {
  const ids = new Set<string>();
  if (id === null) return ids;
  ids.add(id);
  const text = texts.find((t) => t.id === id);
  if (text?.component_id) ids.add(text.component_id);
  for (const t of texts) if (t.component_id === id) ids.add(t.id);
  return ids;
}
