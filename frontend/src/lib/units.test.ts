import { describe, expect, it } from "vitest";
import { engineering, norm, unitOf, withUnit } from "./units";

const OHM = "Ω";
const OHM_SIGN = "Ω";
const MICRO_SIGN = "µ";
const MU = "μ";

describe("norm", () => {
  it("removes spaces", () => expect(norm(" 1 k ")).toBe("1k"));
  it("maps micro sign to mu", () => expect(norm(`4.7${MICRO_SIGN}F`)).toBe(`4.7${MU}F`));
  it("maps ohm sign to omega", () => expect(norm(`1k${OHM_SIGN}`)).toBe(`1k${OHM}`));
  it("leaves plain text alone", () => {
    expect(norm("10mH")).toBe("10mH");
    expect(norm("")).toBe("");
  });
});

describe("unitOf", () => {
  it.each(["sin(2t)", "cos(wt)", "5 sin"])("reads %s as AC", (t) => expect(unitOf(t)).toBe("AC"));
  it("checks Hz before H", () => expect(unitOf("2kHz")).toBe("Hz"));
  it("reads millihenry as H", () => expect(unitOf("10mH")).toBe("H"));
  it("accepts the ohm sign", () => {
    expect(unitOf(`1k${OHM_SIGN}`)).toBe(OHM);
    expect(unitOf(`1k${OHM}`)).toBe(OHM);
  });
  it.each([
    ["10nF", "F"],
    ["12V", "V"],
    ["2A", "A"],
    ["5VA", "V"],
    ["1 0 V", "V"],
  ])("reads %s as %s", (t, u) => expect(unitOf(t)).toBe(u));
  it.each(["1k", "R1", "", "10m"])("finds no unit in %j", (t) => expect(unitOf(t)).toBeNull());
});

describe("withUnit", () => {
  it("adds the default unit", () => {
    expect(withUnit("1k", "Resistor")).toBe(`1k${OHM}`);
    expect(withUnit("10n", "Capacitor")).toBe("10nF");
    expect(withUnit("5m", "Inductor")).toBe("5mH");
    expect(withUnit("12", "V-DC")).toBe("12V");
    expect(withUnit("2", "I-DC")).toBe("2A");
  });
  it("keeps text that has a unit", () => {
    expect(withUnit(`1k${OHM}`, "Resistor")).toBe(`1k${OHM}`);
    expect(withUnit("10V", "Resistor")).toBe("10V");
  });
  it("leaves classes without a default unit alone", () => {
    expect(withUnit("1k", "GND")).toBe("1k");
    expect(withUnit("5", "V-AC")).toBe("5");
  });
});

describe("engineering", () => {
  const flat = (e: ReturnType<typeof engineering>) => e && { pretty: e.pretty, base: e.base?.replace(/\s/g, " ") ?? null };
  it("reads a prefixed value with the class unit", () => {
    expect(flat(engineering("4.7k", "Resistor"))).toEqual({ pretty: `4.7 k${OHM}`, base: `= 4 700 ${OHM}` });
  });
  it("handles every SI prefix", () => {
    expect(flat(engineering("10pF", null))).toEqual({ pretty: "10 pF", base: "= 0.00000000001 F" });
    expect(flat(engineering("2n", "Capacitor"))?.base).toBe("= 0.000000002 F");
    expect(flat(engineering("10µF", null))?.base).toBe("= 0.00001 F");
    expect(flat(engineering("100mH", null))?.base).toBe("= 0.1 H");
    expect(flat(engineering("2.2M", "Resistor"))?.base).toBe(`= 2 200 000 ${OHM}`);
    expect(flat(engineering("1G", "Resistor"))?.base).toBe(`= 1 000 000 000 ${OHM}`);
  });
  it("has no second line without a prefix", () => {
    expect(engineering("10V", "V-DC")).toEqual({ pretty: "10 V", base: null });
  });
  it("returns null for anything else", () => {
    expect(engineering("sin(wt)", "V-AC")).toBeNull();
    expect(engineering("", null)).toBeNull();
  });
});
