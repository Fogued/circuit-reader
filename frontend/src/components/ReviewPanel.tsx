import { useEffect, useMemo, useRef, useState } from "react";
import type { Component, TextItem } from "../types";
import type { Action, Doc } from "../state/reducer";
import { visibleItems } from "../state/reducer";
import { COMPONENT_CLASSES, classColor } from "../lib/classes";
import { engineering, norm, unitOf } from "../lib/units";

export interface Limits {
  compMin: number;
  textMin: number;
  reviewBelow: number;
}

interface Props {
  doc: Doc;
  serverThresholds: { comp_conf: number; text_conf: number };
  limits: Limits;
  onLimits: (l: Limits) => void;
  /** Ids a person should look at: low confidence and not yet checked. */
  flagged: ReadonlySet<string>;
  /** Ids a person changed. */
  edited: ReadonlySet<string>;
  activeId: string | null;
  selectedId: string | null;
  assigning: boolean;
  dispatch: (a: Action) => void;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  onAssigning: (on: boolean) => void;
}

type Row = { kind: "component"; item: Component } | { kind: "value"; item: TextItem };
type Filter = "all" | "components" | "values";
const FILTER_LABEL: Record<Filter, string> = { all: "All", components: "Components", values: "Values" };

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function ReviewPanel(p: Props) {
  const { limits } = p;
  // Same mapping as the viewer and the exports: a value is cleared when its component is hidden.
  const vis = useMemo(() => visibleItems(p.doc, { compMin: limits.compMin, textMin: limits.textMin }), [p.doc, limits.compMin, limits.textMin]);
  const doc = useMemo<Doc>(() => ({ ...p.doc, components: vis.components, texts: vis.texts }), [p.doc, vis]);
  const [filter, setFilter] = useState<Filter>("all");
  const [onlyReview, setOnlyReview] = useState(false);

  const rows = useMemo<Row[]>(() => {
    const all: Row[] = [
      ...vis.components.map((item) => ({ kind: "component" as const, item })),
      ...vis.texts.map((item) => ({ kind: "value" as const, item })),
    ];
    return all.sort((a, b) => a.item.conf - b.item.conf);
  }, [vis]);

  const toCheck = rows.filter((r) => p.flagged.has(r.item.id)).length;
  const shown = rows.filter(
    (r) => (filter === "all" || (filter === "components") === (r.kind === "component")) && (!onlyReview || p.flagged.has(r.item.id)),
  );

  return (
    <aside className="panel" aria-label="Review panel">
      <div className="panel-head">
        <h2>Review</h2>
        <p className={`count${toCheck ? " open" : ""}`} data-testid="review-count">
          {toCheck ? `${toCheck} to check` : "Nothing left to check"}
        </p>
      </div>
      <details className="thresholds">
        <summary>Thresholds</summary>
        <Slider
          label="Component confidence"
          min={p.serverThresholds.comp_conf}
          value={limits.compMin}
          onChange={(v) => p.onLimits({ ...limits, compMin: v })}
        />
        <Slider
          label="Text confidence"
          min={p.serverThresholds.text_conf}
          value={limits.textMin}
          onChange={(v) => p.onLimits({ ...limits, textMin: v })}
        />
        <Slider
          label="Check items below"
          min={0}
          value={limits.reviewBelow}
          onChange={(v) => p.onLimits({ ...limits, reviewBelow: v })}
        />
      </details>
      <div className="list-tools">
        <div className="filter" role="group" aria-label="Item type">
          {(["all", "components", "values"] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
          Only items to check
        </label>
      </div>
      <ul className="items">
        {shown.map((r) => (
          <ItemRow key={r.item.id} row={r} {...p} doc={doc} />
        ))}
        {shown.length === 0 && <li className="empty">Nothing to show with these filters.</li>}
      </ul>
    </aside>
  );
}

function Slider(props: { label: string; min: number; value: number; onChange: (v: number) => void }) {
  const id = `sl-${props.label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="slider">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type="range"
        min={props.min}
        max={1}
        step={0.01}
        value={Math.max(props.value, props.min)}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <output htmlFor={id}>{pct(props.value)}</output>
    </div>
  );
}

function Pencil() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1.5 10.5 2 8 8.6 1.4a1 1 0 0 1 1.4 0l.6.6a1 1 0 0 1 0 1.4L4 10z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function Tick() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="m2 6.4 2.6 2.6L10 3.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ItemRow({ row, ...p }: Props & { row: Row }) {
  const { doc, dispatch } = p;
  const { id, conf } = row.item;
  const flagged = p.flagged.has(id);
  const edited = p.edited.has(id);
  const reviewed = doc.reviewed.includes(id);
  const selected = p.selectedId === id;
  const active = p.activeId === id;
  const li = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) li.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  return (
    <li
      ref={li}
      className={`item${selected ? " selected" : ""}${active ? " active" : ""}`}
      data-testid={`item-${id}`}
      onPointerEnter={() => p.onHover(id)}
      onPointerLeave={() => p.onHover(null)}
    >
      <button
        type="button"
        className="item-head"
        aria-expanded={selected}
        onClick={() => {
          p.onSelect(selected ? null : id);
          p.onAssigning(false);
        }}
      >
        {row.kind === "component" ? (
          <>
            <span className="swatch" style={{ background: classColor(row.item.cls) }} />
            <span className="item-main">{row.item.cls}</span>
          </>
        ) : (
          <>
            <span className="swatch dashed" />
            <span className="item-main">
              {row.item.value !== null ? (
                <>
                  <span data-testid={`value-${id}`}>{row.item.value}</span>
                  {row.item.value !== row.item.text && <span className="muted"> from {row.item.text || "(empty)"}</span>}
                </>
              ) : (
                <>
                  {row.item.text || "(empty)"}
                  <span className="muted"> not attached</span>
                </>
              )}
            </span>
          </>
        )}
        <span className="item-meta">
          {edited && (
            <span className="mark red">
              <Pencil />
              Edited
            </span>
          )}
          {flagged && (
            <span className="mark red">
              <Pencil />
              Check
            </span>
          )}
          {reviewed && (
            <span className="mark">
              <Tick />
              Checked
            </span>
          )}
          <span className="muted conf">{pct(conf)}</span>
        </span>
      </button>
      {selected && (
        <div className="item-body">
          {row.kind === "component" ? (
            <ComponentEditor c={row.item} dispatch={dispatch} />
          ) : (
            <TextEditor t={row.item} doc={doc} dispatch={dispatch} assigning={p.assigning} onAssigning={p.onAssigning} />
          )}
          <div className="actions">
            <button type="button" onClick={() => dispatch({ type: "toggleReviewed", id })}>
              {reviewed ? "Mark as unchecked" : "Mark as checked"}
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                dispatch(row.kind === "component" ? { type: "deleteComponent", id } : { type: "deleteText", id });
                p.onSelect(null);
                p.onAssigning(false);
              }}
            >
              Delete detection
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function ComponentEditor({ c, dispatch }: { c: Component; dispatch: (a: Action) => void }) {
  const options = (COMPONENT_CLASSES as readonly string[]).includes(c.cls) ? COMPONENT_CLASSES : [c.cls, ...COMPONENT_CLASSES];
  return (
    <div className="field">
      <label htmlFor={`cls-${c.id}`}>Class</label>
      <select id={`cls-${c.id}`} value={c.cls} onChange={(e) => dispatch({ type: "setClass", id: c.id, cls: e.target.value })}>
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextEditor(props: {
  t: TextItem;
  doc: Doc;
  dispatch: (a: Action) => void;
  assigning: boolean;
  onAssigning: (on: boolean) => void;
}) {
  const { t, doc, dispatch } = props;
  const attachable = doc.components;
  const cls = doc.components.find((c) => c.id === t.component_id)?.cls ?? null;
  const eng = t.value !== null ? engineering(t.value, cls) : null;
  const [draft, setDraft] = useState(t.text);
  useEffect(() => setDraft(t.text), [t.text]);
  const commit = () => {
    dispatch({ type: "editText", id: t.id, text: draft });
    // The stored text has its spaces removed; show the same so no stray leading space stays in the field.
    setDraft(norm(draft));
  };
  return (
    <>
      <div className="field">
        <label htmlFor={`text-${t.id}`}>Text</label>
        <input
          id={`text-${t.id}`}
          value={draft}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setDraft(t.text);
          }}
        />
      </div>
      <p className="hint">
        Value: <strong>{t.value ?? "none (not attached)"}</strong>
        {t.value !== null && unitOf(t.text) === null && t.value !== t.text && ", unit added from the component class"}
        {t.value !== null && unitOf(t.text) === null && t.value === t.text && ", no unit in the text"}
      </p>
      {eng && (
        <p className="eng" data-testid={`eng-${t.id}`}>
          <span>{eng.pretty}</span>
          {eng.base && <span className="muted">{eng.base}</span>}
        </p>
      )}
      <div className="field">
        <label htmlFor={`att-${t.id}`}>Attached to</label>
        <select
          id={`att-${t.id}`}
          value={t.component_id ?? ""}
          onChange={(e) => dispatch({ type: "reassign", id: t.id, componentId: e.target.value || null })}
        >
          <option value="">None</option>
          {attachable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id}, {c.cls}
            </option>
          ))}
        </select>
      </div>
      <div className="actions">
        <button type="button" aria-pressed={props.assigning} onClick={() => props.onAssigning(!props.assigning)}>
          {props.assigning ? "Cancel picking" : "Pick the component in the drawing"}
        </button>
      </div>
    </>
  );
}
