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

const PREFIX_EXP: Record<string, number> = { p: -12, n: -9, "μ": -6, u: -6, m: -3, k: 3, M: 6, G: 9 };

export interface Engineering {
  /** e.g. "4.7 kΩ" */
  pretty: string;
  /** e.g. "= 4 700 Ω", only when a prefix was used */
  base: string | null;
}

/** Group the integer digits in threes with a thin separator ("4 700"). */
function grouped(n: number): string {
  const [int = "", frac] = n.toString().split(".");
  const g = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return frac ? `${g}.${frac}` : g;
}

/**
 * Display-only reading of a component value: "4.7k" + Resistor gives "4.7 kΩ" and "= 4 700 Ω".
 * Returns null when the text is not a plain number with an optional SI prefix and unit.
 * Never used for the exported text or the matching rules.
 */
export function engineering(text: string, cls: string | null): Engineering | null {
  const t = norm(text);
  const m = /^(\d+(?:\.\d+)?)([pnμumkMG])?(Hz|Ω|F|H|V|A)?$/.exec(t);
  if (!m) return null;
  const num = m[1] as string;
  const prefix = m[2];
  const unit = m[3] ?? (cls ? DEFAULT_UNIT[cls] : undefined) ?? "";
  const pretty = `${num} ${prefix === "u" ? "μ" : (prefix ?? "")}${unit}`.trim();
  if (!prefix) return { pretty, base: null };
  const exp = PREFIX_EXP[prefix] as number;
  const value = Number((Number(num) * 10 ** exp).toPrecision(12));
  const base = exp > 0 ? grouped(value) : value.toLocaleString("en-US", { maximumFractionDigits: 15, useGrouping: false });
  return { pretty, base: `= ${base} ${unit}`.trim() };
}
