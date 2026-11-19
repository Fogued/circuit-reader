import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

const demo = (f: string) => readFileSync(join(__dirname, "..", "test-fixtures", "demo", f), "utf8");

const fetchMock = vi.fn((url: string) => {
  if (url.endsWith("/demo/index.json")) return Promise.resolve(new Response(demo("index.json")));
  if (url.endsWith("/demo/synthetic-rc.json")) return Promise.resolve(new Response(demo("synthetic-rc.json")));
  return Promise.resolve(new Response("not found", { status: 404 }));
});

beforeEach(() => {
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
  await screen.findByTestId("overlay");
  return user;
}

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
