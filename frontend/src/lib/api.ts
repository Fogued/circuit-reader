import type { DemoEntry, Health, ReadResult } from "../types";

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const BASE = import.meta.env.BASE_URL;

export const demoUrl = (file: string): string => `${BASE}demo/${file}`;

function isHealth(x: unknown): x is Health {
  if (typeof x !== "object" || x === null) return false;
  const h = x as Partial<Health>;
  return h.status === "ok" && (h.mode === "live" || h.mode === "demo") && Array.isArray(h.classes);
}

/** Backend health, or null when the backend is unreachable or answers with something else (e.g. a static host). */
export async function fetchHealth(timeoutMs = 3000): Promise<Health | null> {
  try {
    const res = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isHealth(body) ? body : null;
  } catch {
    return null;
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
