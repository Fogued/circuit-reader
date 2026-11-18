import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHealth, readImage } from "./api";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("fetchHealth", () => {
  it("returns the health document", async () => {
    const h = { status: "ok", mode: "live", classes: ["a"] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(h)));
    expect(await fetchHealth()).toEqual(h);
  });
  it("falls back to null on network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await fetchHealth()).toBeNull();
  });
  it("falls back to null on HTML answers (static hosting)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html></html>", { status: 200 })));
    expect(await fetchHealth()).toBeNull();
  });
  it("falls back to null on error status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({}, 404)));
    expect(await fetchHealth()).toBeNull();
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
