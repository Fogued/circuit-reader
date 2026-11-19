import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { DemoEntry, ReadResult } from "./types";
import { demoUrl, loadDemoIndex, loadDemoResult } from "./lib/api";
import { DEFAULT_THRESHOLDS } from "./lib/metrics";
import { baseName, buildYolo, download, toJson } from "./lib/export";
import { canRedo, canUndo, initialState, needsReview, reducer, toResult, visibleItems } from "./state/reducer";
import { Header, type Tab } from "./components/Header";
import { Disclosure } from "./components/Disclosure";
import { Sheets } from "./components/Sheets";
import { Viewer } from "./components/Viewer";
import { ReviewPanel, type Limits } from "./components/ReviewPanel";
import { MetricsTab } from "./components/MetricsTab";

const REVIEW_BELOW = 0.85;

export default function App() {
  const [tab, setTab] = useState<Tab>("review");
  const [state, dispatch] = useReducer(reducer, initialState);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [gallery, setGallery] = useState<DemoEntry[]>([]);
  const [limits, setLimits] = useState<Limits>({ ...limitsFrom(DEFAULT_THRESHOLDS), reviewBelow: REVIEW_BELOW });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = useCallback((result: ReadResult, url: string, id: string) => {
    dispatch({ type: "load", result });
    setImageUrl(url);
    setCurrentId(id);
    setLimits({ ...limitsFrom(result.thresholds), reviewBelow: REVIEW_BELOW });
    setSelectedId(null);
    setHoverId(null);
    setAssigning(false);
  }, []);

  // Only the latest sheet request may land: a slower, older one is dropped.
  const requested = useRef(0);
  const openSheet = useCallback(
    async (entry: DemoEntry, signal?: AbortSignal) => {
      const n = ++requested.current;
      try {
        const result = await loadDemoResult(entry, signal);
        if (n === requested.current && !signal?.aborted) {
          setError(null);
          show(result, demoUrl(entry.image), entry.id);
        }
      } catch (e) {
        if (n === requested.current && !signal?.aborted) setError(e instanceof Error ? e.message : "Could not load the sheet.");
      }
    },
    [show],
  );

  // The page is complete at rest: the first sheet opens by itself.
  useEffect(() => {
    const ac = new AbortController();
    loadDemoIndex(ac.signal)
      .then((g) => {
        if (ac.signal.aborted) return;
        setGallery(g);
        const first = g[0];
        if (first) return openSheet(first, ac.signal);
      })
      .catch((e: unknown) => {
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : "Could not load the sheets.");
      });
    return () => ac.abort();
  }, [openSheet]);

  // Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y); leave native undo alone inside text fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || tab !== "review") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && (t as HTMLInputElement).type === "text"))) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if (k === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);

  const doc = state.doc;
  const meta = state.meta;
  const visible = useMemo(() => {
    if (!doc) return null;
    const { components, texts } = visibleItems(doc, { compMin: limits.compMin, textMin: limits.textMin });
    return { comps: components, texts };
  }, [doc, limits.compMin, limits.textMin]);

  const exportResult = useMemo(
    () => toResult(state, { comp_conf: limits.compMin, text_conf: limits.textMin }),
    [state, limits.compMin, limits.textMin],
  );
  const yolo = useMemo(() => (exportResult ? buildYolo(exportResult) : null), [exportResult]);
  const doExport = (kind: "json" | "yolo") => {
    const r = exportResult;
    if (!r) return;
    const stem = baseName(r.image.name);
    if (kind === "json") download(`${stem}.json`, toJson(r), "application/json");
    else download(`${stem}.txt`, buildYolo(r).text, "text/plain");
  };

  // What a person should look at (low confidence, not yet checked) and what a person changed.
  const flagged = useMemo(() => {
    const ids = new Set<string>();
    if (!doc || !visible) return ids;
    for (const it of [...visible.comps, ...visible.texts]) if (needsReview(it.conf, it.id, doc, limits.reviewBelow)) ids.add(it.id);
    return ids;
  }, [doc, visible, limits.reviewBelow]);
  const edited = useMemo(() => {
    const ids = new Set<string>();
    const o = state.original;
    if (!doc || !o) return ids;
    const comps = new Map(o.components.map((c) => [c.id, c]));
    const texts = new Map(o.texts.map((t) => [t.id, t]));
    for (const c of doc.components) if (comps.get(c.id)?.cls !== c.cls) ids.add(c.id);
    for (const t of doc.texts) {
      const was = texts.get(t.id);
      if (was && (was.text !== t.text || was.component_id !== t.component_id)) ids.add(t.id);
    }
    return ids;
  }, [doc, state.original]);

  const select = (id: string | null) => {
    setSelectedId(id);
    if (id === null) setAssigning(false);
  };

  const toolbar = (
    <div className="toolbar" role="toolbar" aria-label="Edit and export">
      <div className="group">
        <button type="button" onClick={() => dispatch({ type: "undo" })} disabled={!canUndo(state)} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button type="button" onClick={() => dispatch({ type: "redo" })} disabled={!canRedo(state)} title="Redo (Ctrl+Shift+Z)">
          Redo
        </button>
        <button type="button" onClick={() => dispatch({ type: "reset" })} disabled={state.original === doc}>
          Reset
        </button>
      </div>
      <div className="group">
        {yolo && yolo.skipped.total > 0 && (
          <Disclosure
            label={`${yolo.skipped.total} skipped`}
            testId="skipped-note"
            text={`YOLO export skips ${yolo.skipped.components} tiny components, ${yolo.skipped.texts} tiny texts and ${yolo.skipped.unknownClass} boxes with an unknown class`}
          />
        )}
        <button type="button" onClick={() => doExport("json")}>Export JSON</button>
        <button type="button" className="primary" onClick={() => doExport("yolo")}>Export YOLO labels</button>
      </div>
    </div>
  );

  return (
    <div className="app">
      <Header tab={tab} onTab={setTab} />
      <main>
        <div role="tabpanel" id="panel-review" aria-labelledby="tab-review" hidden={tab !== "review"}>
          {error && (
            <p className="notice" role="alert" data-testid="message">
              {error}
            </p>
          )}
          {meta && doc && visible && imageUrl && (
            <div className="workspace">
              <div className="drawing">
                <Sheets
                  gallery={gallery}
                  currentId={currentId}
                  onOpen={(e) => void openSheet(e)}
                  after={
                    <section className="upload-concept" aria-label="Future upload">
                      <div>
                        <h2>Run your own circuit</h2>
                        <p className="muted">Upload a drawing to run the model</p>
                      </div>
                      <button type="button" disabled title="Demo only: uploading and model execution are not available">
                        Choose file
                      </button>
                    </section>
                  }
                />
                {meta.source !== "model" && (
                  <p className="note" data-testid="synthetic-note">
                    Synthetic example. Run scripts/export_demo.py with the trained weights to add real examples.
                  </p>
                )}
                <Viewer
                  imageUrl={imageUrl}
                  width={meta.image.width}
                  height={meta.image.height}
                  components={visible.comps}
                  texts={visible.texts}
                  flagged={flagged}
                  activeId={hoverId ?? selectedId}
                  selectedId={selectedId}
                  assigning={assigning && selectedId !== null}
                  onHover={setHoverId}
                  onSelect={select}
                  onPickComponent={(cid) => {
                    if (selectedId) dispatch({ type: "reassign", id: selectedId, componentId: cid });
                    setAssigning(false);
                  }}
                >
                  {toolbar}
                </Viewer>
              </div>
              <ReviewPanel
                doc={doc}
                serverThresholds={meta.thresholds}
                limits={limits}
                onLimits={setLimits}
                flagged={flagged}
                edited={edited}
                activeId={hoverId}
                selectedId={selectedId}
                assigning={assigning}
                dispatch={dispatch}
                onHover={setHoverId}
                onSelect={select}
                onAssigning={setAssigning}
              />
            </div>
          )}
        </div>
        <div role="tabpanel" id="panel-metrics" aria-labelledby="tab-metrics" hidden={tab !== "metrics"}>
          {tab === "metrics" && <MetricsTab />}
        </div>
      </main>
    </div>
  );
}

function limitsFrom(t: { comp_conf: number; text_conf: number }) {
  return { compMin: t.comp_conf, textMin: t.text_conf };
}
