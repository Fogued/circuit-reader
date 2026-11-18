import { StrictMode } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

const demo = (f: string) => readFileSync(join(__dirname, "..", "test-fixtures", "demo", f), "utf8");

let onHealth: () => Promise<Response> = () => Promise.resolve(new Response("<html></html>", { status: 200 }));
let onRead: () => Promise<Response> = () => Promise.resolve(new Response(demo("synthetic-rc.json")));
const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
const fetchMock = vi.fn((url: string) => {
  if (url.endsWith("/api/health")) return onHealth();
  if (url.includes("/api/read")) return onRead();
  if (url.endsWith("/demo/index.json")) return Promise.resolve(new Response(demo("index.json")));
  if (url.endsWith("/demo/synthetic-rc.json")) return Promise.resolve(new Response(demo("synthetic-rc.json")));
  return Promise.resolve(new Response("<html></html>", { status: 200 }));
});

beforeEach(() => {
  onHealth = () => Promise.resolve(new Response("<html></html>", { status: 200 }));
  onRead = () => Promise.resolve(new Response(demo("synthetic-rc.json")));
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openExample() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: /Open example: Synthetic RC circuit/ }));
  await screen.findByTestId("overlay");
  return user;
}

const png = () => new File(["x"], "a.png", { type: "image/png" });
const healthCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/api/health")).length;

describe("health retry", () => {
  const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

  it("treats connection refused as still starting, then goes live", async () => {
    vi.useFakeTimers();
    let n = 0;
    onHealth = () =>
      ++n < 3 ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve(json({ status: "ok", mode: "live", classes: [] }));
    render(<App />);
    await tick(0);
    expect(screen.getByTestId("mode-badge")).toHaveTextContent("Connecting to model");
    await tick(2000);
    expect(screen.getByTestId("mode-badge")).toHaveTextContent("Live model");
  });

  it("keeps polling slowly in demo mode and switches to live", async () => {
    vi.useFakeTimers();
    let live = false;
    onHealth = () => Promise.resolve(json({ status: "ok", mode: live ? "live" : "demo", classes: [], detail: "no weights" }));
    render(<App />);
    await tick(0);
    expect(screen.getByTestId("mode-badge")).toHaveTextContent("Demo");
    const before = healthCalls();
    await tick(14_000);
    expect(healthCalls()).toBe(before);
    live = true;
    await tick(2000);
    expect(screen.getByTestId("mode-badge")).toHaveTextContent("Live model");
  });

  it("cancels its timers when unmounted, also under StrictMode", async () => {
    vi.useFakeTimers();
    onHealth = () => Promise.resolve(json({ status: "ok", mode: "demo", classes: [] }));
    const { unmount } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await tick(0);
    await tick(15_000);
    const calls = healthCalls();
    expect(calls).toBeGreaterThan(1);
    unmount();
    await tick(120_000);
    expect(healthCalls()).toBe(calls);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("races", () => {
  let finish: (r: Response) => void = () => undefined;
  let reads = 0;
  beforeEach(() => {
    reads = 0;
    onHealth = () => Promise.resolve(json({ status: "ok", mode: "live", classes: [] }));
    onRead = () => {
      reads += 1;
      return new Promise<Response>((r) => (finish = r));
    };
  });

  it("ignores drops and example clicks while a read is busy", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Live model");
    await user.upload(screen.getByTestId("file-input"), png());
    const example = await screen.findByRole("button", { name: /Open example/ });
    expect(example).toBeDisabled();
    const zone = document.querySelector(".dropzone") as HTMLElement;
    expect(zone).toHaveClass("disabled");
    fireEvent.drop(zone, { dataTransfer: { files: [png()] } });
    await user.click(example);
    expect(reads).toBe(1);
    expect(screen.queryByTestId("overlay")).toBeNull();
    await act(async () => finish(new Response(demo("synthetic-rc.json"))));
    await screen.findByTestId("overlay");
    expect(screen.getByRole("button", { name: /Open example/ })).toBeEnabled();
  });

  it("discards a result that arrives after unmount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await screen.findByText("Live model");
    await user.upload(screen.getByTestId("file-input"), png());
    unmount();
    await act(async () => finish(new Response(demo("synthetic-rc.json"))));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

describe("review panel", () => {
  it("lets the user detach a value by choosing None", async () => {
    const user = await openExample();
    await user.click(within(screen.getByTestId("item-t2")).getByRole("button", { name: /4\.7k/ }));
    const label = () => document.querySelector('[data-testid="text-box"][data-id="t2"] text')?.textContent;
    expect(label()).toBe("4.7kH");
    await user.selectOptions(screen.getByLabelText("Attached to"), "");
    expect(screen.getByLabelText<HTMLSelectElement>("Attached to").value).toBe("");
    expect(label()).toBe("4.7k");
    expect(screen.queryByTestId("value-t2")).toBeNull();
    await user.selectOptions(screen.getByLabelText("Attached to"), "c1");
    expect(screen.getByTestId("value-t2")).toHaveTextContent("4.7kΩ");
  });

  it("uses the same visible mapping as the viewer when a component is hidden", async () => {
    const user = await openExample();
    fireEvent.change(screen.getByLabelText("Component confidence"), { target: { value: "0.8" } });
    await waitFor(() => expect(screen.queryByTestId("item-c2")).toBeNull());
    expect(screen.queryByTestId("value-t2")).toBeNull();
    await user.click(within(screen.getByTestId("item-t2")).getByRole("button", { name: /4\.7k/ }));
    expect(screen.getByLabelText<HTMLSelectElement>("Attached to").value).toBe("");
    expect(screen.getByText(/none \(not attached\)/)).toBeInTheDocument();
  });

  it("drops a leading space from the text draft after editing", async () => {
    const user = await openExample();
    await user.click(within(screen.getByTestId("item-t2")).getByRole("button", { name: /4\.7k/ }));
    const input = screen.getByLabelText<HTMLInputElement>("Text", { exact: true });
    await user.clear(input);
    await user.type(input, " 4.7k");
    await user.tab();
    expect(input.value).toBe("4.7k");
  });
});

describe("keyboard and touch access", () => {
  it("reveals the demo reason from a button", async () => {
    onHealth = () => Promise.resolve(json({ status: "ok", mode: "demo", classes: [], detail: "weights not found" }));
    const user = userEvent.setup();
    render(<App />);
    const btn = await screen.findByRole("button", { name: "Why?" });
    expect(screen.getByText("weights not found")).not.toBeVisible();
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("weights not found")).toBeVisible();
  });

  it("lists the family members from the legend button", async () => {
    const user = await openExample();
    await user.click(screen.getByRole("button", { name: "Passives" }));
    expect(screen.getByText("Resistor, Capacitor, Inductor")).toBeVisible();
  });
});

describe("charts", () => {
  const width = (w: number) => vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(w);

  it("draws at the container's pixel width and wraps class names on narrow screens", async () => {
    width(340);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Metrics" }));
    const bar = screen.getByTestId("bar-chart");
    expect(bar).toHaveAttribute("width", "340");
    expect(bar).toHaveAttribute("viewBox", expect.stringMatching(/^0 0 340 /));
    expect(screen.getByTestId("history-chart")).toHaveAttribute("width", "340");
    expect(bar.querySelectorAll("tspan").length).toBeGreaterThan(18);
    expect([...bar.querySelectorAll("tspan")].map((t) => t.textContent)).toContain("(one port)");
  });

  it("uses one line per class on wide screens", async () => {
    width(700);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Metrics" }));
    expect(screen.getByTestId("bar-chart").querySelectorAll("tspan")).toHaveLength(18);
  });

  it("shows the bar tooltip on keyboard focus without role=status; bars sit in a list", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Metrics" }));
    const chart = screen.getByTestId("bar-chart");
    expect(chart).toHaveAttribute("role", "list");
    const items = within(chart).getAllByRole("listitem");
    expect(items).toHaveLength(18);
    fireEvent.focus(items[0] as Element);
    const tip = document.querySelector(".tip") as HTMLElement;
    expect(tip).toHaveTextContent("AP50-95");
    expect(tip).not.toHaveAttribute("role");
  });

  it("makes line-chart points focusable with the same tooltip", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Metrics" }));
    const points = within(screen.getByTestId("history-chart")).getAllByRole("listitem");
    expect(points.length).toBeGreaterThan(1);
    points.forEach((p) => expect(p).toHaveAttribute("tabindex", "0"));
    fireEvent.focus(points[1] as Element);
    expect(document.querySelector(".tip")).toHaveTextContent("exact match");
    expect(document.querySelector(".tip")).toHaveTextContent("Epoch");
  });
});
