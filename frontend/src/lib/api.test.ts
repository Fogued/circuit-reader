import { afterEach, describe, expect, it, vi } from "vitest";
import { demoUrl, pollUntilLive, probeHealth, readImage, waitForHealth } from "./api";

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
  it("treats connection refused as pending: the server may still be starting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await probeHealth()).toEqual({ state: "pending" });
  });
  it("rejects when the caller aborts", async () => {
    const ac = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal?.addEventListener("abort", () => rej(new TypeError("x"))))));
    const p = probeHealth(3000, ac.signal);
    ac.abort();
    await expect(p).rejects.toThrow();
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
  it("retries connection refused until the budget is spent", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new TypeError("refused")).mockResolvedValue(json(okHealth));
    vi.stubGlobal("fetch", fn);
    expect(await waitForHealth({ sleep: () => Promise.resolve() })).toEqual(okHealth);
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it("does not retry when the server answers with a 404", async () => {
    const fn = vi.fn().mockResolvedValue(json({}, 404));
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

describe("fake timers", () => {
  afterEach(() => vi.useRealTimers());

  it("stops probing and clears its timer when aborted", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new TypeError("refused"));
    vi.stubGlobal("fetch", fn);
    const ac = new AbortController();
    const p = waitForHealth({ signal: ac.signal });
    await vi.advanceTimersByTimeAsync(1600);
    const calls = fn.mock.calls.length;
    expect(calls).toBeGreaterThan(1);
    ac.abort();
    expect(await p).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fn.mock.calls.length).toBe(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps polling slowly after the budget and resolves once the backend is live", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockResolvedValueOnce(json({ status: "ok", mode: "demo", classes: [] }))
      .mockResolvedValueOnce(json({ status: "ok", mode: "demo", classes: [] }))
      .mockResolvedValue(json(okHealth));
    vi.stubGlobal("fetch", fn);
    const p = pollUntilLive({ intervalMs: 15_000 });
    await vi.advanceTimersByTimeAsync(14_000);
    expect(fn).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await p).toEqual(okHealth);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("stops polling when aborted", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new TypeError("refused"));
    vi.stubGlobal("fetch", fn);
    const ac = new AbortController();
    const p = pollUntilLive({ intervalMs: 1000, signal: ac.signal });
    await vi.advanceTimersByTimeAsync(3500);
    const calls = fn.mock.calls.length;
    ac.abort();
    expect(await p).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fn.mock.calls.length).toBe(calls);
    expect(vi.getTimerCount()).toBe(0);
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
