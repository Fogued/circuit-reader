import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

const demo = (f: string) => readFileSync(join(__dirname, "..", "public", "demo", f), "utf8");

let onHealth: () => Promise<Response> = () => Promise.resolve(new Response("<html></html>", { status: 200 }));
const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });

beforeEach(() => {
  onHealth = () => Promise.resolve(new Response("<html></html>", { status: 200 }));
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.endsWith("/api/health")) return onHealth();
      if (url.includes("/api/read")) return Promise.resolve(new Response(demo("synthetic-rc.json")));
      if (url.endsWith("/demo/index.json")) return Promise.resolve(new Response(demo("index.json")));
      if (url.endsWith("/demo/synthetic-rc.json")) return Promise.resolve(new Response(demo("synthetic-rc.json")));
      return Promise.resolve(new Response("<html></html>", { status: 200 }));
    }),
  );
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
  await user.click(await screen.findByRole("button", { name: /Open example: Synthetic RC circuit/ }));
  await screen.findByTestId("overlay");
  return user;
}

describe("App", () => {
  it("falls back to demo mode when the backend is unreachable", async () => {
    render(<App />);
    expect(await screen.findByText("Demo")).toBeInTheDocument();
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
    expect(screen.getByTestId("review-count")).toHaveTextContent("3 need review");
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

  it("explains that inference needs the backend in demo mode", async () => {
    const user = await openExample();
    await user.upload(screen.getByTestId("file-input"), new File(["x"], "a.png", { type: "image/png" }));
    expect(await screen.findByTestId("message")).toHaveTextContent("needs the backend");
  });

  it("shows the metrics from the bundled results", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Metrics" }));
    expect(screen.getByText("0.989")).toBeInTheDocument();
    expect(screen.getByText("90.3%")).toBeInTheDocument();
  });

  it("shows the server's reason for demo mode in the badge tooltip", async () => {
    onHealth = () => Promise.resolve(json({ status: "ok", mode: "demo", classes: [], detail: "weights not found" }));
    render(<App />);
    const badge = await screen.findByText("Demo");
    expect(badge).toHaveAttribute("title", "weights not found");
  });

  it("waits for a slow health check instead of showing the demo notice", async () => {
    let answer: (r: Response) => void = () => undefined;
    onHealth = () => new Promise<Response>((r) => (answer = r));
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByText(/Connecting to model/)).toBeInTheDocument();
    await user.upload(screen.getByTestId("file-input"), new File(["x"], "a.png", { type: "image/png" }));
    expect(await screen.findByTestId("message")).toHaveTextContent("Connecting to the model");
    answer(json({ status: "ok", mode: "live", classes: [] }));
    await screen.findByTestId("overlay");
    expect(screen.queryByTestId("message")).toBeNull();
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

  it("reports skipped boxes next to the export button", async () => {
    await openExample();
    expect(screen.queryByTestId("skipped-note")).toBeNull();
    const user = userEvent.setup();
    await user.click(within(screen.getByTestId("item-c2")).getByRole("button", { name: /Inductor/ }));
    await user.selectOptions(screen.getByLabelText("Class", { exact: true }), "Resistor");
    expect(screen.queryByTestId("skipped-note")).toBeNull();
  });
});
