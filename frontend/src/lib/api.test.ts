import { afterEach, describe, expect, it, vi } from "vitest";
import { demoUrl, probeHealth, readImage, waitForHealth } from "./api";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const timeout = () => new DOMException("timed out", "TimeoutError");
const okHealth = { status: "ok", mode: "live", classes: ["a"] };

describe("probeHealth", () => {
  it("returns the health document, including the optional detail", async () => {
    const h = { status: "ok", mode: "demo", classes: ["a"], detail: "no weights" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(h)));
    expect(await probeHealth()).toEqual({ state: "ok", health: h });
  });
  it("is unreachable on network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await probeHealth()).toEqual({ state: "unreachable" });
  });
  it("is unreachable on HTML answers (static hosting)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html></html>", { status: 200 })));
    expect(await probeHealth()).toEqual({ state: "unreachable" });
  });
  it("is unreachable on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({}, 404)));
    expect(await probeHealth()).toEqual({ state: "unreachable" });
  });
  it("is pending on a timeout or a 5xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout()));
    expect(await probeHealth()).toEqual({ state: "pending" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({}, 503)));
    expect(await probeHealth()).toEqual({ state: "pending" });
  });
});

describe("waitForHealth", () => {
  it("retries slow answers with growing delays until the server responds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(timeout())
      .mockResolvedValue(json(okHealth));
    vi.stubGlobal("fetch", fn);
    const delays: number[] = [];
    const h = await waitForHealth({ sleep: (ms) => Promise.resolve(void delays.push(ms)) });
    expect(h).toEqual(okHealth);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([500, 1000]);
  });
  it("does not retry when the server is unreachable", async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fn);
    expect(await waitForHealth({ sleep: () => Promise.resolve() })).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("gives up once the budget is spent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout()));
    let t = 0;
    const h = await waitForHealth({
      budgetMs: 10_000,
      now: () => t,
      sleep: (ms) => Promise.resolve(void (t += ms + 3000)),
    });
    expect(h).toBeNull();
    expect(t).toBeLessThan(20_000);
  });
});

describe("demoUrl", () => {
  it("encodes each path segment but keeps the slashes", () => {
    expect(demoUrl("my circuit #1.svg")).toBe("/demo/my%20circuit%20%231.svg");
    expect(demoUrl("a b/c?.json")).toBe("/demo/a%20b/c%3F.json");
  });
});

describe("readImage", () => {
  it("surfaces the server detail on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ detail: "model not loaded (demo mode)" }, 503)));
    await expect(readImage(new File(["x"], "a.png"))).rejects.toThrow("model not loaded (demo mode)");
  });
  it("posts the file with thresholds", async () => {
    const fn = vi.fn().mockResolvedValue(json({ ok: 1 }));
    vi.stubGlobal("fetch", fn);
    await readImage(new File(["x"], "a.png"), { comp_conf: 0.5, text_conf: 0.25 });
    expect(fn.mock.calls[0]?.[0]).toBe("/api/read?comp_conf=0.5&text_conf=0.25");
    expect((fn.mock.calls[0]?.[1] as RequestInit).method).toBe("POST");
  });
});
