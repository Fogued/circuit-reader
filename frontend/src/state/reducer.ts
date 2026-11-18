import type { Component, ReadResult, TextItem } from "../types";
import { norm, withUnit } from "../lib/units";

/** The editable part of a result; this is what undo/redo snapshots. */
export interface Doc {
  components: Component[];
  texts: TextItem[];
  reviewed: string[]; // ids of items marked as reviewed
}

export interface ReviewState {
  meta: Pick<ReadResult, "image" | "thresholds" | "source"> | null;
  original: Doc | null;
  doc: Doc | null;
  past: Doc[];
  future: Doc[];
}

export type Action =
  | { type: "load"; result: ReadResult }
  | { type: "setClass"; id: string; cls: string }
  | { type: "editText"; id: string; text: string }
  | { type: "reassign"; id: string; componentId: string | null }
  | { type: "deleteComponent"; id: string }
  | { type: "deleteText"; id: string }
  | { type: "toggleReviewed"; id: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset" };

export const initialState: ReviewState = { meta: null, original: null, doc: null, past: [], future: [] };

const HISTORY_LIMIT = 200;

/** Value of a text given the component it is attached to (null when unattached). */
export function valueFor(text: string, cls: string | undefined): string | null {
  return cls === undefined ? null : withUnit(text, cls);
}

function clsOf(doc: Doc, componentId: string | null): string | undefined {
  return componentId === null ? undefined : doc.components.find((c) => c.id === componentId)?.cls;
}

function commit(state: ReviewState, doc: Doc): ReviewState {
  return { ...state, doc, past: [...state.past, state.doc as Doc].slice(-HISTORY_LIMIT), future: [] };
}

export function reducer(state: ReviewState, action: Action): ReviewState {
  if (action.type === "load") {
    const { components, texts, ...meta } = action.result;
    const doc: Doc = { components, texts, reviewed: [] };
    return { meta, original: doc, doc, past: [], future: [] };
  }
  const doc = state.doc;
  if (!doc) return state;

  switch (action.type) {
    case "setClass": {
      const target = doc.components.find((c) => c.id === action.id);
      if (!target || target.cls === action.cls) return state;
      const components = doc.components.map((c) => (c.id === action.id ? { ...c, cls: action.cls } : c));
      const texts = doc.texts.map((t) =>
        t.component_id === action.id ? { ...t, value: valueFor(t.text, action.cls) } : t,
      );
      return commit(state, { ...doc, components, texts });
    }
    case "editText": {
      const target = doc.texts.find((t) => t.id === action.id);
      const text = norm(action.text);
      if (!target || target.text === text) return state;
      const cls = clsOf(doc, target.component_id);
      const texts = doc.texts.map((t) => (t.id === action.id ? { ...t, text, value: valueFor(text, cls) } : t));
      return commit(state, { ...doc, texts });
    }
    case "reassign": {
      const target = doc.texts.find((t) => t.id === action.id);
      if (!target || target.component_id === action.componentId) return state;
      if (action.componentId !== null && !doc.components.some((c) => c.id === action.componentId)) return state;
      const cls = clsOf(doc, action.componentId);
      const texts = doc.texts.map((t) =>
        t.id === action.id ? { ...t, component_id: action.componentId, value: valueFor(t.text, cls) } : t,
      );
      return commit(state, { ...doc, texts });
    }
    case "deleteComponent": {
      if (!doc.components.some((c) => c.id === action.id)) return state;
      return commit(state, {
        components: doc.components.filter((c) => c.id !== action.id),
        texts: doc.texts.map((t) => (t.component_id === action.id ? { ...t, component_id: null, value: null } : t)),
        reviewed: doc.reviewed.filter((r) => r !== action.id),
      });
    }
    case "deleteText": {
      if (!doc.texts.some((t) => t.id === action.id)) return state;
      return commit(state, {
        ...doc,
        texts: doc.texts.filter((t) => t.id !== action.id),
        reviewed: doc.reviewed.filter((r) => r !== action.id),
      });
    }
    case "toggleReviewed": {
      const reviewed = doc.reviewed.includes(action.id)
        ? doc.reviewed.filter((r) => r !== action.id)
        : [...doc.reviewed, action.id];
      return commit(state, { ...doc, reviewed });
    }
    case "undo": {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return { ...state, doc: prev, past: state.past.slice(0, -1), future: [doc, ...state.future] };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return { ...state, doc: next, past: [...state.past, doc], future: state.future.slice(1) };
    }
    case "reset": {
      if (!state.original || state.original === doc) return state;
      return commit(state, state.original);
    }
  }
}

export const canUndo = (s: ReviewState): boolean => s.past.length > 0;
export const canRedo = (s: ReviewState): boolean => s.future.length > 0;

/** Does the item need review? Below the confidence limit and not yet marked as reviewed. */
export function needsReview(conf: number, id: string, doc: Doc, limit: number): boolean {
  return conf < limit && !doc.reviewed.includes(id);
}

/** The corrected result: items under the given confidence thresholds are left out. */
export function toResult(state: ReviewState, thresholds: { comp_conf: number; text_conf: number }): ReadResult | null {
  if (!state.meta || !state.doc) return null;
  const components = state.doc.components.filter((c) => c.conf >= thresholds.comp_conf);
  const ids = new Set(components.map((c) => c.id));
  const texts = state.doc.texts
    .filter((t) => t.conf >= thresholds.text_conf)
    .map((t) => (t.component_id !== null && !ids.has(t.component_id) ? { ...t, component_id: null, value: null } : t));
  return { ...state.meta, components, texts, thresholds };
}
