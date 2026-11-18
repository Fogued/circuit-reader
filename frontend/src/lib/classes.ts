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

/**
 * Component families: the viewer colours boxes by family (5 categorical slots) instead of one hue per class,
 * because more than 8 categorical colours cannot be told apart. Slot n maps to the CSS token --cat-n.
 * Palette check (scripts/validate_palette.js, slots 1-5, surfaces #fcfcfb / #1a1a19):
 *   adjacent pairs pass in light and dark (worst CVD dE 9.1 light / 8.4 dark, normal vision 19.6 / 19.3);
 *   --pairs all fails the CVD and normal-vision floors, and light slots 3-5 sit under 3:1 on the surface.
 * Class identity is therefore never colour-alone: every box carries its class label and the legend names the
 * families and their members.
 */
export interface Family {
  slot: 1 | 2 | 3 | 4 | 5;
  name: string;
  members: readonly string[];
}

export const FAMILIES: readonly Family[] = [
  { slot: 1, name: "Passives", members: ["Resistor", "Capacitor", "Inductor"] },
  { slot: 2, name: "Sources", members: ["V-DC", "V-DC (one port)", "V-AC", "I-DC", "I-AC"] },
  { slot: 3, name: "Semiconductors", members: ["Diode", "Zener Diode", "BJT-NPN", "BJT-PNP", "MOSFET-N", "MOSFET-P"] },
  { slot: 4, name: "Op-Amp", members: ["Op-Amp"] },
  { slot: 5, name: "Reference & wiring", members: ["GND", "Wire Crossover"] },
];

export function familyOf(cls: string): Family {
  return FAMILIES.find((f) => f.members.includes(cls)) ?? (FAMILIES[0] as Family);
}

/** CSS colour of a class: the token of its family. */
export const classColor = (cls: string): string => `var(--cat-${familyOf(cls).slot})`;
