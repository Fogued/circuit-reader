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

const overlaps = (a: Box, b: Box): boolean => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

export interface LabelSpot {
  /** Left edge and text baseline, in image pixels. */
  x: number;
  y: number;
}

export interface LabelPlacement {
  spots: Map<string, LabelSpot>;
  /** Value labels sit under their text box; exposed so the viewer draws them where they were reserved. */
  valueSpots: Map<string, LabelSpot>;
}

/**
 * Place the class label of every component so it avoids the text boxes, the value labels and the labels already
 * placed. Tries above the box, then below, then left, then right, then inside the top edge; falls back to
 * "above" when every spot is taken. `fs` is the font size in image pixels (12 / zoom), so labels keep a constant
 * on-screen size.
 */
export function placeLabels(
  components: { id: string; cls: string; box: Box }[],
  texts: { id: string; box: Box; value: string | null; text: string }[],
  fs: number,
  imageW: number,
  imageH: number,
): LabelPlacement {
  const gap = fs / 6;
  const h = fs * 1.2;
  const charW = fs * 0.62;
  const spots = new Map<string, LabelSpot>();
  const valueSpots = new Map<string, LabelSpot>();
  const taken: Box[] = [];
  for (const t of texts) {
    taken.push(t.box);
    const w = (t.value ?? t.text).length * charW;
    const top = t.box[3] + gap;
    valueSpots.set(t.id, { x: t.box[0], y: top + fs });
    taken.push([t.box[0], top, t.box[0] + w, top + h]);
  }
  const inside = (r: Box): boolean => r[0] >= 0 && r[1] >= 0 && r[2] <= imageW && r[3] <= imageH;
  for (const c of components) {
    const w = c.cls.length * charW;
    const [x1, y1, x2, y2] = c.box;
    const anchors: [number, number][] = [
      [x1, y1 - h - gap],
      [x1, y2 + gap],
      [x1 - w - gap, y1],
      [x2 + gap, y1],
      [x1 + gap, y1 + gap],
    ];
    const free = anchors.find(([x, top]) => {
      const r: Box = [x, top, x + w, top + h];
      return inside(r) && !taken.some((o) => overlaps(r, o));
    });
    const [x, top] = free ?? (anchors[0] as [number, number]);
    taken.push([x, top, x + w, top + h]);
    spots.set(c.id, { x, y: top + fs });
  }
  return { spots, valueSpots };
}
