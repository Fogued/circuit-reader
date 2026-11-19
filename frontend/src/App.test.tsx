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
  vi.unstubAllGlobals();
});

async function openExample() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("overlay");
  return user;
}

describe("App", () => {
  it("opens the first sheet by itself and never calls an API", async () => {
    render(<App />);
    expect(await screen.findByTestId("overlay")).toBeInTheDocument();
    expect(screen.getAllByTestId("comp-box")).toHaveLength(5);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/"))).toBe(false);
  });

  it("shows the future upload concept as disabled and has no mode badge", async () => {
    await openExample();
    const upload = screen.getByRole("region", { name: "Future upload" });
    expect(within(upload).getByRole("heading", { name: "Run your own circuit" })).toBeInTheDocument();
    expect(within(upload).getByText(/Upload a drawing to run the model/i)).toBeInTheDocument();
    expect(within(upload).getByRole("button", { name: "Choose file" })).toBeDisabled();
    expect(screen.queryByTestId("mode-badge")).toBeNull();
  });

  it("shows the synthetic label and draws every detection", async () => {
    await openExample();
    expect(screen.getByTestId("synthetic-note")).toHaveTextContent("Synthetic example");
    expect(screen.getAllByTestId("comp-box")).toHaveLength(5);
    expect(screen.getAllByTestId("text-box")).toHaveLength(4);
  });

  it("lists the least confident item first", async () => {
    await openExample();
    const items = screen.getAllByTestId(/^item-/);
    expect(items[0]).toHaveAttribute("data-testid", "item-t3");
    expect(items[1]).toHaveAttribute("data-testid", "item-c2");
    expect(screen.getByTestId("review-count")).toHaveTextContent("3 to check");
  });

  it("marks items that need a look with a ring in the drawing", async () => {
    await openExample();
    expect(document.querySelectorAll(".rings rect")).toHaveLength(3);
  });

  it("marks an item edited after a person changes it", async () => {
    const user = await openExample();
    expect(within(screen.getByTestId("item-c2")).queryByText("Edited")).toBeNull();
    await user.click(within(screen.getByTestId("item-c2")).getByRole("button", { name: /Inductor/ }));
    await user.selectOptions(screen.getByLabelText("Class", { exact: true }), "Resistor");
    expect(within(screen.getByTestId("item-c2")).getByText("Edited")).toBeInTheDocument();
  });

  it("edits a value, then undoes it with the keyboard", async () => {
    const user = await openExample();
    await user.click(within(screen.getByTestId("item-t2")).getByRole("button", { name: /4\.7k/ }));
    expect(screen.getByTestId("value-t2")).toHaveTextContent("4.7kH");
    await user.selectOptions(screen.getByLabelText("Attached to"), "c1");
    expect(screen.getByTestId("value-t2")).toHaveTextContent("4.7kΩ");
    await user.keyboard("{Control>}z{/Control}");
    expect(screen.getByTestId("value-t2")).toHaveTextContent("4.7kH");
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(screen.getByTestId("value-t2")).toHaveTextContent("4.7kΩ");
  });

  it("shows the metrics from the bundled results", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Metrics" }));
    expect(screen.getByText("0.989")).toBeInTheDocument();
    expect(screen.getByText(/were found, read exactly and attached/)).toHaveTextContent("On 1,194 held-out handwritten values, 90.3 % were found");
  });

  it("clears the value of a text whose component is hidden by the slider", async () => {
    const user = await openExample();
    const label = () => document.querySelector('[data-testid="text-box"][data-id="t2"] text')?.textContent;
    expect(label()).toBe("4.7kH");
    fireEvent.change(screen.getByLabelText("Component confidence"), { target: { value: "0.8" } });
    await waitFor(() => expect(label()).toBe("4.7k"));
    await user.click(within(screen.getByTestId("item-t2")).getByRole("button", { name: /4\.7k/ }));
    const options = within(screen.getByLabelText("Attached to")).getAllByRole("option").map((o) => o.textContent);
    expect(options.join("|")).not.toContain("c2");
    expect(options.join("|")).toContain("c1");
    expect(options[0]).toBe("None");
  });

  it("keeps the thresholds in a closed disclosure", async () => {
    await openExample();
    const details = screen.getByText("Thresholds").closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
  });

  it("reports skipped boxes next to the export button", async () => {
    await openExample();
    expect(screen.queryByTestId("skipped-note")).toBeNull();
    const user = userEvent.setup();
    await user.click(within(screen.getByTestId("item-c2")).getByRole("button", { name: /Inductor/ }));
    await user.selectOptions(screen.getByLabelText("Class", { exact: true }), "Resistor");
    expect(screen.queryByTestId("skipped-note")).toBeNull();
  });
});

describe("sheets", () => {
  it("lists the examples as numbered sheets and switches between them", async () => {
    const entry = { id: "synthetic-rc", title: "Synthetic RC circuit", image: "synthetic-rc.svg", result: "synthetic-rc.json" };
    const second = { ...entry, id: "second", title: "Second circuit" };
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/demo/index.json")) return Promise.resolve(new Response(JSON.stringify([entry, second])));
      if (url.endsWith(".json")) return Promise.resolve(new Response(demo("synthetic-rc.json")));
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("overlay");
    const first = screen.getByRole("button", { name: /Sheet 1.*Synthetic RC circuit/ });
    const next = screen.getByRole("button", { name: /Sheet 2.*Second circuit/ });
    expect(first).toHaveAttribute("aria-current", "true");
    expect(next).not.toHaveAttribute("aria-current");
    await user.click(next);
    await waitFor(() => expect(next).toHaveAttribute("aria-current", "true"));
    expect(first).not.toHaveAttribute("aria-current");
  });

  it("says so when the sheets cannot be loaded", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response("nope", { status: 404 })));
    render(<App />);
    expect(await screen.findByTestId("message")).toHaveTextContent("Could not load the sheets");
  });
});
