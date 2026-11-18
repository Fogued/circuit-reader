import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

const demo = (f: string) => readFileSync(join(__dirname, "..", "public", "demo", f), "utf8");

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
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
});
