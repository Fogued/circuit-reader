/** Port of the matching rules in circuit_reader.py (norm, unit_of, with_unit). */

const MICRO_SIGN = "µ";
const GREEK_MU = "μ";
const OHM_SIGN = "Ω";
const OMEGA = "Ω";

/** Unit -> component classes that can carry that unit. */
export const UNIT_CLASSES: Record<string, readonly string[]> = {
  AC: ["V-AC", "I-AC"],
  Hz: ["V-AC", "I-AC"],
  [OMEGA]: ["Resistor"],
  F: ["Capacitor"],
  H: ["Inductor"],
  V: ["V-DC", "V-DC (one port)", "V-AC"],
  A: ["I-DC", "I-AC"],
};

/** Unit appended to a bare number ("1k") next to a component of this class. */
export const DEFAULT_UNIT: Record<string, string> = {
  Resistor: OMEGA,
  Capacitor: "F",
  Inductor: "H",
  "V-DC": "V",
  "V-DC (one port)": "V",
  "I-DC": "A",
};

/** Remove spaces; map the micro sign to mu and the ohm sign to omega. */
export function norm(text: string): string {
  return text.replaceAll(" ", "").replaceAll(MICRO_SIGN, GREEK_MU).replaceAll(OHM_SIGN, OMEGA);
}

/** Unit found in a label: "AC" for sin/cos, else the first of Hz, omega, F, H, V, A that occurs, else null. */
export function unitOf(text: string): string | null {
  const t = norm(text);
  if (t.includes("sin") || t.includes("cos")) return "AC";
  for (const u of ["Hz", OMEGA, "F", "H", "V", "A"]) {
    if (t.includes(u)) return u;
  }
  return null;
}

/** Append the default unit of `cls` if the text has none. */
export function withUnit(text: string, cls: string): string {
  const unit = DEFAULT_UNIT[cls];
  return unitOf(text) || unit === undefined ? text : text + unit;
}
