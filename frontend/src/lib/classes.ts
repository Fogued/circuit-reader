/** Component classes in detector order (class ids 0-16 of the YOLO labels); "text" is id 17. */
export const COMPONENT_CLASSES = [
  "BJT-NPN",
  "BJT-PNP",
  "Capacitor",
  "Diode",
  "GND",
  "I-AC",
  "I-DC",
  "Inductor",
  "MOSFET-N",
  "MOSFET-P",
  "Op-Amp",
  "Resistor",
  "V-AC",
  "V-DC",
  "V-DC (one port)",
  "Wire Crossover",
  "Zener Diode",
] as const;

export const TEXT_CLASS_ID = COMPONENT_CLASSES.length;

/** Categorical colour per class: fixed hue, theme-dependent saturation/lightness via CSS variables. */
const HUE_ORDER = [0, 7, 14, 4, 11, 1, 8, 15, 5, 12, 2, 9, 16, 6, 13, 3, 10];

export function classColor(cls: string): string {
  const i = COMPONENT_CLASSES.indexOf(cls as (typeof COMPONENT_CLASSES)[number]);
  const slot = HUE_ORDER[i < 0 ? 0 : i] ?? 0;
  const hue = Math.round((slot * 360) / COMPONENT_CLASSES.length + 8) % 360;
  return `hsl(${hue} var(--cat-s) var(--cat-l))`;
}
