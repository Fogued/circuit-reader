import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const OHM = "Ω";

async function openExample(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("mode-badge")).toHaveText("Demo");
  await page.getByRole("button", { name: /Open example: Synthetic RC circuit/ }).click();
  await expect(page.getByTestId("overlay")).toBeVisible();
}

test("loads in demo mode and the gallery shows the fixture", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Circuit Reader Studio" })).toBeVisible();
  await expect(page.getByTestId("mode-badge")).toHaveText("Demo");
  await expect(page.getByRole("button", { name: /Open example: Synthetic RC circuit/ })).toBeVisible();
});

test("overlay renders all boxes and labels the example as synthetic", async ({ page }) => {
  await openExample(page);
  await expect(page.getByTestId("comp-box")).toHaveCount(5);
  await expect(page.getByTestId("text-box")).toHaveCount(4);
  await expect(page.getByTestId("synthetic-note")).toContainText("Synthetic example");
  // the drawing has loaded and the overlay sits on top of it
  const img = page.locator(".stage img");
  await expect(img).toHaveJSProperty("complete", true);
});

test("editing a value updates it and undo restores it", async ({ page }) => {
  await openExample(page);
  await page.getByTestId("item-t2").getByRole("button").first().click();
  await expect(page.getByTestId("value-t2")).toHaveText("4.7kH");
  const input = page.getByLabel("Text", { exact: true });
  await input.fill("4.7kV");
  await input.press("Enter");
  await expect(page.getByTestId("value-t2")).toHaveText("4.7kV");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("value-t2")).toHaveText("4.7kH");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByTestId("value-t2")).toHaveText("4.7kV");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("value-t2")).toHaveText("4.7kH");
});

test("changing the class recomputes the value", async ({ page }) => {
  await openExample(page);
  await page.getByTestId("item-c2").getByRole("button").first().click();
  await page.getByLabel("Class", { exact: true }).selectOption("Resistor");
  await page.getByTestId("item-t2").getByRole("button").first().click();
  await expect(page.getByTestId("value-t2")).toHaveText(`4.7k${OHM}`);
});

test("hovering an item highlights its pair in the viewer", async ({ page }) => {
  await openExample(page);
  await page.getByTestId("item-t1").hover();
  await expect(page.locator('[data-testid="comp-box"][data-id="c1"]')).toHaveClass(/hot/);
  await expect(page.locator('[data-testid="comp-box"][data-id="c0"]')).toHaveClass(/dim/);
});

test("export produces a YOLO file with one line per visible box", async ({ page }) => {
  await openExample(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export YOLO labels" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("synthetic-rc.txt");
  const text = readFileSync((await download.path()) as string, "utf8");
  const lines = text.trimEnd().split("\n");
  expect(lines).toHaveLength(9);
  for (const l of lines) expect(l).toMatch(/^\d{1,2}( \d\.\d{6}){4}$/);
  expect(lines.filter((l) => l.startsWith("17 "))).toHaveLength(4);
});

test("deleting a false positive removes it from the export", async ({ page }) => {
  await openExample(page);
  await page.getByTestId("item-c4").getByRole("button").first().click();
  await page.getByRole("button", { name: "Delete false positive" }).click();
  await expect(page.getByTestId("comp-box")).toHaveCount(4);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export YOLO labels" }).click(),
  ]);
  const lines = readFileSync((await download.path()) as string, "utf8").trimEnd().split("\n");
  expect(lines).toHaveLength(8);
});

test("uploading in demo mode explains that inference needs the backend", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("mode-badge")).toHaveText("Demo");
  await page.getByTestId("file-input").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: Buffer.from("x") });
  await expect(page.getByTestId("message")).toContainText("needs the backend");
});

test("metrics tab shows the bundled results", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Metrics" }).click();
  await expect(page.getByText("0.989").first()).toBeVisible();
  await expect(page.getByText("90.3%")).toBeVisible();
  await expect(page.getByTestId("bar-chart")).toBeVisible();
  await expect(page.getByTestId("class-table").locator("tbody tr")).toHaveCount(18);
  await page.getByRole("button", { name: "Validation" }).click();
  await expect(page.getByText("0.985").first()).toBeVisible();
});

test("bar chart rows show a tooltip and the value line shows engineering notation", async ({ page }) => {
  await openExample(page);
  await page.getByTestId("item-t2").getByRole("button").first().click();
  await expect(page.getByTestId("eng-t2")).toContainText("4.7 kH");
  await page.getByRole("tab", { name: "Metrics" }).click();
  await page.getByTestId("bar-chart").getByLabel(/^V-AC: AP50-95/).hover();
  await expect(page.locator(".tip")).toContainText("V-AC");
});

test("no horizontal scroll on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ["review", "metrics"]) {
    await openExample(page);
    if (tab === "metrics") await page.getByRole("tab", { name: "Metrics" }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
});

test("chart text stays at least 11px on a 390px phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Metrics" }).click();
  for (const id of ["bar-chart", "history-chart"]) {
    // Effective size = CSS font-size x the scale the SVG is drawn at (1 when it is not scaled down).
    const sizes = await page.getByTestId(id).evaluate((svg) => {
      const el = svg as unknown as SVGSVGElement;
      const scale = el.getBoundingClientRect().width / el.viewBox.baseVal.width;
      return [...el.querySelectorAll("text")].map((t) => parseFloat(getComputedStyle(t).fontSize) * scale);
    });
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);
  }
});

test("a slow health check keeps the connecting state instead of locking into demo", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/health", async (route) => {
    calls += 1;
    if (calls === 1) return; // never answers: the first probe times out
    await route.fulfill({ json: { status: "ok", mode: "live", classes: [] } });
  });
  await page.goto("/");
  await expect(page.getByTestId("mode-badge")).toContainText("Connecting to model");
  await expect(page.getByTestId("mode-badge")).toHaveText("Live model", { timeout: 15_000 });
  expect(calls).toBeGreaterThan(1);
});

test("the demo badge shows the server's reason", async ({ page }) => {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { status: "ok", mode: "demo", classes: [], detail: "weights not found" } }),
  );
  await page.goto("/");
  await expect(page.getByTestId("mode-badge")).toHaveAttribute("title", "weights not found");
});

test("class labels do not sit on top of text boxes", async ({ page }) => {
  await openExample(page);
  const overlaps = await page.evaluate(() => {
    const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const labels = [...document.querySelectorAll('[data-testid="comp-box"] text')].map((n) => n.getBoundingClientRect());
    const boxes = [...document.querySelectorAll('[data-testid="text-box"] rect')].map((n) => n.getBoundingClientRect());
    return labels.filter((l) => boxes.some((b) => hit(l, b))).length;
  });
  expect(overlaps).toBe(0);
});
