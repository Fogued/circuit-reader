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
  /** No usable backend: 404 or a non-JSON answer (e.g. a static host). */
  | { state: "unreachable" }
  /**
   * The server may be there but is not answering yet: timeout, connection refused (the process is still
   * starting) or 5xx while the models load.
   */
  | { state: "pending" };

export async function probeHealth(timeoutMs = 3000, signal?: AbortSignal): Promise<HealthProbe> {
  let res: Response;
  try {
    const limit = AbortSignal.timeout(timeoutMs);
    res = await fetch(`${API}/api/health`, { signal: signal ? AbortSignal.any([signal, limit]) : limit });
  } catch (e) {
    // The caller cancelled: do not report a state for it.
    if (signal?.aborted) throw e instanceof DOMException ? e : new DOMException("aborted", "AbortError");
    return { state: "pending" };
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
  /** Total time to keep retrying while the server is slow to answer or not up yet. */
  budgetMs?: number;
  timeoutMs?: number;
  firstDelayMs?: number;
  maxDelayMs?: number;
  /** Cancels pending probes and timers; the wait then resolves to null. */
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

/** Resolves after ms, or early (without error) when the signal aborts. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Backend health, retrying with backoff while the server is slow or not up yet (models loading).
 * Null when it is unreachable, still silent after the budget, or the wait was cancelled.
 */
export async function waitForHealth(o: WaitOptions = {}): Promise<Health | null> {
  const { budgetMs = 30_000, timeoutMs = 3000, firstDelayMs = 500, maxDelayMs = 4000, signal } = o;
  const sleep = o.sleep ?? abortableSleep;
  const now = o.now ?? Date.now;
  const start = now();
  let delay = firstDelayMs;
  for (;;) {
    if (signal?.aborted) return null;
    let r: HealthProbe;
    try {
      r = await probeHealth(timeoutMs, signal);
    } catch {
      return null;
    }
    if (r.state === "ok") return r.health;
    if (r.state === "unreachable" || now() - start + delay >= budgetMs) return null;
    await sleep(delay, signal);
    delay = Math.min(delay * 2, maxDelayMs);
  }
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Slow background polling after the initial budget: resolves with the health document once the backend
 * reports live mode, or null when cancelled.
 */
export async function pollUntilLive(o: PollOptions = {}): Promise<Health | null> {
  const { intervalMs = 15_000, timeoutMs = 3000, signal } = o;
  const sleep = o.sleep ?? abortableSleep;
  for (;;) {
    await sleep(intervalMs, signal);
    if (signal?.aborted) return null;
    try {
      const r = await probeHealth(timeoutMs, signal);
      if (r.state === "ok" && r.health.mode === "live") return r.health;
    } catch {
      return null;
    }
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

export async function loadDemoIndex(signal?: AbortSignal): Promise<DemoEntry[]> {
  const res = await fetch(demoUrl("index.json"), { signal });
  if (!res.ok) throw new Error("Could not load the demo gallery");
  return (await res.json()) as DemoEntry[];
}

export async function loadDemoResult(entry: DemoEntry): Promise<ReadResult> {
  const res = await fetch(demoUrl(entry.result));
  if (!res.ok) throw new Error(`Could not load ${entry.title}`);
  return (await res.json()) as ReadResult;
}
