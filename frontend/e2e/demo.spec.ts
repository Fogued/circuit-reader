import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OHM = "Ω";

// The interaction tests use a small synthetic fixture (with a deliberate misclassification) so their
// expectations stay fixed; it is served in place of the public gallery, which holds real model outputs.
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "test-fixtures", "demo");
const PUBLIC_DEMO = join(HERE, "..", "public", "demo");

test.beforeEach(async ({ page }) => {
  await page.route(/\/demo\/(index\.json|synthetic-rc\.(json|svg))$/, (route) => {
    const file = new URL(route.request().url()).pathname.split("/").pop() as string;
    return route.fulfill({
      path: join(FIXTURES, file),
      contentType: file.endsWith(".svg") ? "image/svg+xml" : "application/json",
    });
  });
});

/** The first sheet opens on its own: the page is complete at rest. */
async function openExample(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("overlay")).toBeVisible();
}

test("the public gallery holds real model outputs and every sheet opens", async ({ page }) => {
  await page.unrouteAll();
  await page.goto("/");
  const index = JSON.parse(readFileSync(join(PUBLIC_DEMO, "index.json"), "utf8")) as {
    id: string;
    title: string;
    result: string;
  }[];
  expect(index.length).toBeGreaterThan(0);
  for (const e of index) {
    const result = JSON.parse(readFileSync(join(PUBLIC_DEMO, e.result), "utf8"));
    expect(result.source).toBe("model");
  }
  for (const [i, e] of index.entries()) {
    const tab = page.getByRole("button", { name: new RegExp(`Sheet ${i + 1}.*${e.title}`) });
    await expect(tab).toBeVisible();
    // The first sheet is already open; the others open on click.
    if (i > 0) await tab.click();
    await expect(tab).toHaveAttribute("aria-current", "true");
    const result = JSON.parse(readFileSync(join(PUBLIC_DEMO, e.result), "utf8"));
    await expect(page.getByTestId("comp-box")).toHaveCount(result.components.length);
    await expect(page.getByTestId("text-box")).toHaveCount(result.texts.length);
  }
  await expect(page.getByTestId("synthetic-note")).toHaveCount(0);
});

test("the first example renders on load and nothing calls an API", async ({ page }) => {
  const api: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.includes("/api/")) api.push(r.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Circuit Reader", level: 1 })).toBeVisible();
  await expect(page.getByTestId("overlay")).toBeVisible();
  await expect(page.getByTestId("comp-box")).toHaveCount(5);
  await expect(page.locator(".stage img")).toHaveJSProperty("complete", true);
  await page.waitForLoadState("networkidle");
  expect(api).toEqual([]);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByText(/upload/i)).toHaveCount(0);
});

test("no heading, label, button or table header is set in capitals", async ({ page }) => {
  for (const tab of ["Review", "Metrics"]) {
    await openExample(page);
    await page.getByRole("tab", { name: tab }).click();
    const caps = await page.evaluate(() => {
      const sel = "h1, h2, h3, label, button, summary, th, dt, legend, .count, .mark";
      return [...document.querySelectorAll(sel)]
        .filter((el) => getComputedStyle(el).textTransform !== "none")
        .map((el) => el.textContent?.trim().slice(0, 30));
    });
    expect(caps, tab).toEqual([]);
  }
});

test("one type family: Barlow, no monospace", async ({ page }) => {
  await openExample(page);
  await page.getByRole("tab", { name: "Metrics" }).click();
  await page.evaluate(() => document.fonts.ready);
  const families = await page.evaluate(() => {
    const set = new Set<string>();
    for (const el of document.querySelectorAll("body *")) set.add(getComputedStyle(el).fontFamily.split(",")[0]!.trim().replace(/"/g, ""));
    return [...set];
  });
  expect(families.filter((f) => /mono|plex|inter/i.test(f))).toEqual([]);
  expect(families).toContain("Barlow");
  const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")));
  expect(loaded).toContain("Barlow");
});

test("overlay renders all boxes and labels the example as synthetic", async ({ page }) => {
  await openExample(page);
  await expect(page.getByTestId("comp-box")).toHaveCount(5);
  await expect(page.getByTestId("text-box")).toHaveCount(4);
  await expect(page.getByTestId("synthetic-note")).toContainText("Synthetic example");
  await expect(page.locator(".stage img")).toHaveJSProperty("complete", true);
});

test("the review count and the rings agree", async ({ page }) => {
  await openExample(page);
  await expect(page.getByTestId("review-count")).toHaveText("3 to check");
  await expect(page.locator(".rings rect")).toHaveCount(3);
});

test("editing a value updates it and undo restores it", async ({ page }) => {
  await openExample(page);
  await page.getByTestId("item-t2").getByRole("button").first().click();
  await expect(page.getByTestId("value-t2")).toHaveText("4.7kH");
  const input = page.getByLabel("Text", { exact: true });
  await input.fill("4.7kV");
  await input.press("Enter");
  await expect(page.getByTestId("value-t2")).toHaveText("4.7kV");
  await expect(page.getByTestId("item-t2")).toContainText("Edited");
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

test("the thresholds are closed until asked for", async ({ page }) => {
  await openExample(page);
  await expect(page.getByLabel("Component confidence")).toBeHidden();
  await page.getByText("Thresholds", { exact: true }).click();
  await expect(page.getByLabel("Component confidence")).toBeVisible();
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

test("deleting a detection removes it from the export", async ({ page }) => {
  await openExample(page);
  await page.getByTestId("item-c4").getByRole("button").first().click();
  await page.getByRole("button", { name: "Delete detection" }).click();
  await expect(page.getByTestId("comp-box")).toHaveCount(4);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export YOLO labels" }).click(),
  ]);
  const lines = readFileSync((await download.path()) as string, "utf8").trimEnd().split("\n");
  expect(lines).toHaveLength(8);
});

test("marking an item as checked drops it from the count", async ({ page }) => {
  await openExample(page);
  await page.getByTestId("item-t3").getByRole("button").first().click();
  await page.getByRole("button", { name: "Mark as checked" }).click();
  await expect(page.getByTestId("review-count")).toHaveText("2 to check");
  await expect(page.getByTestId("item-t3")).toContainText("Checked");
});

test("metrics tab leads with the result in words, then the numbers", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Metrics" }).click();
  await expect(page.locator(".lead")).toContainText("On 1,194 held-out handwritten values, 90.3");
  await expect(page.getByText("0.989").first()).toBeVisible();
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

test("no horizontal scroll on a phone with any real example (wide and tall drawings)", async ({ page }) => {
  await page.unrouteAll();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const index = JSON.parse(readFileSync(join(PUBLIC_DEMO, "index.json"), "utf8")) as { title: string }[];
  for (const e of index) {
    await page.getByRole("button", { name: new RegExp(e.title) }).click();
    await expect(page.getByTestId("overlay")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, e.title).toBeLessThanOrEqual(0);
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

test("header links to the repository and the Kaggle notebook", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", "https://github.com/Fogued/circuit-reader");
  await expect(page.getByRole("link", { name: "Kaggle" })).toHaveAttribute(
    "href",
    "https://www.kaggle.com/code/diegofogued/circuit-reader",
  );
});
