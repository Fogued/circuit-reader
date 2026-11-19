import type { DemoEntry, ReadResult } from "../types";

const BASE = import.meta.env.BASE_URL;

const segments = (file: string): string => file.split("/").map(encodeURIComponent).join("/");

/** URL of a file in the bundled gallery (public/demo). */
export const demoUrl = (file: string): string => `${BASE}demo/${segments(file)}`;

export async function loadDemoIndex(signal?: AbortSignal): Promise<DemoEntry[]> {
  const res = await fetch(demoUrl("index.json"), { signal });
  if (!res.ok) throw new Error("Could not load the sheets.");
  return (await res.json()) as DemoEntry[];
}

export async function loadDemoResult(entry: DemoEntry, signal?: AbortSignal): Promise<ReadResult> {
  const res = await fetch(demoUrl(entry.result), { signal });
  if (!res.ok) throw new Error(`Could not load ${entry.title}.`);
  return (await res.json()) as ReadResult;
}
