import { useEffect, useMemo, useRef, useState } from "react";
import type { Component, TextItem } from "../types";
import type { Action, Doc } from "../state/reducer";
import { needsReview, visibleItems } from "../state/reducer";
import { norm } from "../lib/units";
import { COMPONENT_CLASSES, classColor } from "../lib/classes";
import { engineering, unitOf } from "../lib/units";

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

  const flagged = rows.filter((r) => needsReview(r.item.conf, r.item.id, doc, limits.reviewBelow)).length;
  const shown = rows.filter(
    (r) =>
      (filter === "all" || (filter === "components") === (r.kind === "component")) &&
      (!onlyReview || needsReview(r.item.conf, r.item.id, doc, limits.reviewBelow)),
  );

  return (
    <aside className="panel" aria-label="Review panel">
      <section className="panel-section">
        <h2>Filters</h2>
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
          label="Needs review below"
          min={0}
          value={limits.reviewBelow}
          onChange={(v) => p.onLimits({ ...limits, reviewBelow: v })}
        />
      </section>

      <section className="panel-section list-section">
        <div className="list-head">
          <h2>
            Items <span className="muted">({shown.length})</span>
          </h2>
          <span className={`pill ${flagged ? "warn" : "ok"}`} data-testid="review-count">
            {flagged} need review
          </span>
        </div>
        <div className="list-tools">
          <div className="segmented" role="group" aria-label="Item type">
            {(["all", "components", "values"] as const).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {FILTER_LABEL[f]}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
            Needs review only
          </label>
        </div>
        <ul className="items">
          {shown.map((r) => (
            <ItemRow key={r.item.id} row={r} {...p} doc={doc} />
          ))}
          {shown.length === 0 && <li className="empty">Nothing to show with these filters.</li>}
        </ul>
      </section>
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

function ItemRow({ row, ...p }: Props & { row: Row }) {
  const { doc, dispatch } = p;
  const { id, conf } = row.item;
  const flagged = needsReview(conf, id, doc, p.limits.reviewBelow);
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
      className={`item${selected ? " selected" : ""}${active ? " active" : ""}${flagged ? " flagged" : ""}`}
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
              <span className="mono">{row.item.text || "(empty)"}</span>
              {row.item.value !== null && row.item.value !== row.item.text && (
                <>
                  {" "}
                  <span className="muted">&rarr;</span> <span className="mono" data-testid={`value-${id}`}>{row.item.value}</span>
                </>
              )}
              {row.item.value !== null && row.item.value === row.item.text && (
                <span className="visually-hidden" data-testid={`value-${id}`}>{row.item.value}</span>
              )}
            </span>
          </>
        )}
        <span className="item-meta">
          {flagged && (
            <span className="pill warn">
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M5 1 9.5 9h-9z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                <path d="M5 4v2.2M5 7.4v.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              review
            </span>
          )}
          {reviewed && (
            <span className="pill ok">
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="m1.5 5.3 2.3 2.3L8.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              reviewed
            </span>
          )}
          <span className="confbar" aria-hidden="true">
            <span style={{ width: `${Math.round(conf * 100)}%` }} />
          </span>
          <span className="muted mono conf">{pct(conf)}</span>
          <span className="muted mono id">{id}</span>
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
              {reviewed ? "Unmark reviewed" : "Mark reviewed"}
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
              Delete false positive
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
          className="mono"
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
        Value: <strong className="mono">{t.value ?? "none (not attached)"}</strong>
        {t.value !== null && unitOf(t.text) === null && t.value !== t.text && " - unit added from the component class"}
        {t.value !== null && unitOf(t.text) === null && t.value === t.text && " - no unit in the text"}
      </p>
      {eng && (
        <p className="eng" data-testid={`eng-${t.id}`}>
          <span className="mono">{eng.pretty}</span>
          {eng.base && <span className="muted mono">{eng.base}</span>}
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
              {c.id} &middot; {c.cls}
            </option>
          ))}
        </select>
      </div>
      <div className="actions">
        <button type="button" aria-pressed={props.assigning} onClick={() => props.onAssigning(!props.assigning)}>
          {props.assigning ? "Cancel picking" : "Pick component in viewer"}
        </button>
      </div>
    </>
  );
}
