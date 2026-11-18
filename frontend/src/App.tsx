import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { DemoEntry, Health, ReadResult } from "./types";
import { waitForHealth, pollUntilLive, demoUrl, loadDemoIndex, loadDemoResult, readImage } from "./lib/api";
import { DEFAULT_THRESHOLDS } from "./lib/metrics";
import { baseName, buildYolo, download, toJson } from "./lib/export";
import { canRedo, canUndo, initialState, reducer, toResult, visibleItems } from "./state/reducer";
import { Header, type Mode, type Tab } from "./components/Header";
import { Disclosure } from "./components/Disclosure";
import { Uploader } from "./components/Uploader";
import { validateFile } from "./lib/files";
import { Viewer } from "./components/Viewer";
import { ReviewPanel, type Limits } from "./components/ReviewPanel";
import { MetricsTab } from "./components/MetricsTab";

const REVIEW_BELOW = 0.85;
const DEMO_NOTICE =
  "Demo mode: inference needs the backend. Start the API with model weights (see the README) to read your own images.";

export default function App() {
  const [mode, setMode] = useState<Mode>("checking");
  const [modeDetail, setModeDetail] = useState<string | null>(null);
  const health = useRef<Promise<Mode> | null>(null);
  const [tab, setTab] = useState<Tab>("review");
  const [state, dispatch] = useReducer(reducer, initialState);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [gallery, setGallery] = useState<DemoEntry[]>([]);
  const [limits, setLimits] = useState<Limits>({ ...limitsFrom(DEFAULT_THRESHOLDS), reviewBelow: REVIEW_BELOW });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const objectUrl = useRef<string | null>(null);
  // Only one upload/read at a time: busyRef guards synchronously, requestId discards stale results.
  const busyRef = useRef(false);
  const requestId = useRef(0);

  // Health: retry through the initial budget (the server may still be starting), then keep polling slowly in
  // demo mode and switch to live when the backend comes up. The cleanup cancels every timer and request.
  useEffect(() => {
    const ac = new AbortController();
    const { signal } = ac;
    const apply = (h: Health | null) => {
      if (signal.aborted) return;
      setMode(h?.mode === "live" ? "live" : "demo");
      setModeDetail(h?.mode === "demo" ? (h.detail ?? null) : null);
    };
    const check = waitForHealth({ signal }).then((h): Mode => {
      apply(h);
      return h?.mode === "live" ? "live" : "demo";
    });
    health.current = check;
    void check.then(async (m) => {
      if (m !== "demo" || signal.aborted) return;
      const live = await pollUntilLive({ signal });
      if (live) apply(live);
    });
    loadDemoIndex(signal).then((g) => !signal.aborted && setGallery(g)).catch(() => undefined);
    return () => ac.abort();
  }, []);

  // Results of requests started before an unmount (or superseded) are discarded.
  useEffect(
    () => () => {
      requestId.current += 1;
    },
    [],
  );

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  const show = useCallback((result: ReadResult, url: string, id: string | null) => {
    dispatch({ type: "load", result });
    setImageUrl(url);
    setCurrentId(id);
    setLimits({ ...limitsFrom(result.thresholds), reviewBelow: REVIEW_BELOW });
    setSelectedId(null);
    setHoverId(null);
    setAssigning(false);
  }, []);

  const openDemo = useCallback(
    async (entry: DemoEntry) => {
      if (busyRef.current) return;
      busyRef.current = true;
      const id = ++requestId.current;
      setBusy(true);
      setMessage(null);
      try {
        const result = await loadDemoResult(entry);
        if (id === requestId.current) show(result, demoUrl(entry.image), entry.id);
      } catch (e) {
        if (id === requestId.current) setMessage({ kind: "error", text: e instanceof Error ? e.message : "Could not load the example." });
      } finally {
        if (id === requestId.current) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    },
    [show],
  );

  const openFile = useCallback(
    async (file: File) => {
      if (busyRef.current) return;
      const problem = validateFile(file);
      if (problem) return setMessage({ kind: "error", text: problem });
      busyRef.current = true;
      const id = ++requestId.current;
      const current = () => id === requestId.current;
      setBusy(true);
      setMessage(null);
      try {
        let m = mode;
        if (m === "checking" && health.current) {
          setMessage({ kind: "info", text: "Connecting to the model, your image is read as soon as it is ready." });
          m = await health.current;
          if (!current()) return;
          setMessage(null);
        }
        if (m !== "live") return setMessage({ kind: "info", text: DEMO_NOTICE });
        const result = await readImage(file);
        if (!current()) return;
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = URL.createObjectURL(file);
        show(result, objectUrl.current, null);
      } catch (e) {
        if (current()) setMessage({ kind: "error", text: e instanceof Error ? e.message : "The request failed." });
      } finally {
        if (current()) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    },
    [mode, show],
  );

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

  const select = (id: string | null) => {
    setSelectedId(id);
    if (id === null) setAssigning(false);
  };

  return (
    <div className="app">
      <Header mode={mode} detail={modeDetail} tab={tab} onTab={setTab} />
      <main>
        <div role="tabpanel" id="panel-review" aria-labelledby="tab-review" hidden={tab !== "review"}>
          <Uploader mode={mode} gallery={gallery} currentId={currentId} busy={busy} onFile={openFile} onDemo={openDemo} />
          {message && (
            <p className={`notice ${message.kind}`} role={message.kind === "error" ? "alert" : "status"} data-testid="message">
              {message.text}
            </p>
          )}
          {meta && doc && visible && imageUrl ? (
            <>
              {meta.source !== "model" && (
                <p className="notice synthetic" data-testid="synthetic-note">
                  <strong>Synthetic example</strong> &mdash; run scripts/export_demo.py with the trained weights to add real examples.
                </p>
              )}
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
                  <span className="muted small">
                    {visible.comps.length} components, {visible.texts.length} texts
                  </span>
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
              <div className="workspace">
                <Viewer
                  imageUrl={imageUrl}
                  width={meta.image.width}
                  height={meta.image.height}
                  components={visible.comps}
                  texts={visible.texts}
                  activeId={hoverId ?? selectedId}
                  selectedId={selectedId}
                  assigning={assigning && selectedId !== null}
                  onHover={setHoverId}
                  onSelect={select}
                  onPickComponent={(cid) => {
                    if (selectedId) dispatch({ type: "reassign", id: selectedId, componentId: cid });
                    setAssigning(false);
                  }}
                />
                <ReviewPanel
                  doc={doc}
                  serverThresholds={meta.thresholds}
                  limits={limits}
                  onLimits={setLimits}
                  activeId={hoverId}
                  selectedId={selectedId}
                  assigning={assigning}
                  dispatch={dispatch}
                  onHover={setHoverId}
                  onSelect={select}
                  onAssigning={setAssigning}
                />
              </div>
            </>
          ) : (
            <div className="empty-state">
              <h2>Review handwritten circuit detections</h2>
              <p className="muted">
                {mode === "live"
                  ? "Upload a circuit drawing to run the model, then correct what it got wrong and export labels for retraining."
                  : "Open the bundled example to try the review loop: fix a class, edit a value, undo, then export YOLO labels."}
              </p>
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
