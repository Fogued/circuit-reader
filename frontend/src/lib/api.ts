import type { DemoEntry, Health, ReadResult } from "../types";

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const BASE = import.meta.env.BASE_URL;

const segments = (file: string): string => file.split("/").map(encodeURIComponent).join("/");

export const demoUrl = (file: string): string => `${BASE}demo/${segments(file)}`;

function isHealth(x: unknown): x is Health {
  if (typeof x !== "object" || x === null) return false;
  const h = x as Partial<Health>;
  return (
    h.status === "ok" &&
    (h.mode === "live" || h.mode === "demo") &&
    Array.isArray(h.classes) &&
    (h.detail === undefined || h.detail === null || typeof h.detail === "string")
  );
}

export type HealthProbe =
  | { state: "ok"; health: Health }
  /** No usable backend: network error, 404 or a non-JSON answer (e.g. a static host). */
  | { state: "unreachable" }
  /** The server may be there but is not answering yet (timeout or 5xx while models load). */
  | { state: "pending" };

export async function probeHealth(timeoutMs = 3000): Promise<HealthProbe> {
  let res: Response;
  try {
    res = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const timedOut = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
    return { state: timedOut ? "pending" : "unreachable" };
  }
  if (res.status >= 500) return { state: "pending" };
  if (!res.ok) return { state: "unreachable" };
  try {
    const body: unknown = await res.json();
    return isHealth(body) ? { state: "ok", health: body } : { state: "unreachable" };
  } catch {
    return { state: "unreachable" };
  }
}

export interface WaitOptions {
  /** Total time to keep retrying while the server is slow to answer. */
  budgetMs?: number;
  timeoutMs?: number;
  firstDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Backend health, retrying with backoff while the server is slow (models loading).
 * Null when it is unreachable or still silent after the budget.
 */
export async function waitForHealth(o: WaitOptions = {}): Promise<Health | null> {
  const { budgetMs = 30_000, timeoutMs = 3000, firstDelayMs = 500, maxDelayMs = 4000 } = o;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const start = now();
  let delay = firstDelayMs;
  for (;;) {
    const r = await probeHealth(timeoutMs);
    if (r.state === "ok") return r.health;
    if (r.state === "unreachable" || now() - start + delay >= budgetMs) return null;
    await sleep(delay);
    delay = Math.min(delay * 2, maxDelayMs);
  }
}

export async function readImage(file: File, thresholds?: { comp_conf: number; text_conf: number }): Promise<ReadResult> {
  const form = new FormData();
  form.append("file", file);
  const q = thresholds ? `?comp_conf=${thresholds.comp_conf}&text_conf=${thresholds.text_conf}` : "";
  const res = await fetch(`${API}/api/read${q}`, { method: "POST", body: form });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* keep the status message */
    }
    throw new Error(detail);
  }
  return (await res.json()) as ReadResult;
}

export async function loadDemoIndex(): Promise<DemoEntry[]> {
  const res = await fetch(demoUrl("index.json"));
  if (!res.ok) throw new Error("Could not load the demo gallery");
  return (await res.json()) as DemoEntry[];
}

export async function loadDemoResult(entry: DemoEntry): Promise<ReadResult> {
  const res = await fetch(demoUrl(entry.result));
  if (!res.ok) throw new Error(`Could not load ${entry.title}`);
  return (await res.json()) as ReadResult;
}
