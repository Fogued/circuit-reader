import { afterEach, describe, expect, it, vi } from "vitest";
import { demoUrl, loadDemoIndex, loadDemoResult } from "./api";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("demoUrl", () => {
  it("encodes each path segment but keeps the slashes", () => {
    expect(demoUrl("my circuit #1.svg")).toBe("/demo/my%20circuit%20%231.svg");
    expect(demoUrl("a b/c?.json")).toBe("/demo/a%20b/c%3F.json");
  });
});

describe("gallery loading", () => {
  const entry = { id: "a", title: "A", image: "a.jpg", result: "a.json" };

  it("loads the index from the bundled folder", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json([entry]));
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadDemoIndex()).toEqual([entry]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/demo/index.json");
  });

  it("loads a result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ components: [] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadDemoResult(entry)).toEqual({ components: [] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/demo/a.json");
  });

  it("fails with a readable message when a file is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({}, 404)));
    await expect(loadDemoIndex()).rejects.toThrow("Could not load the sheets.");
    await expect(loadDemoResult(entry)).rejects.toThrow("Could not load A.");
  });
});
