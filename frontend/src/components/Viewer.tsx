import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Component, TextItem } from "../types";
import { center, fitView, pairIds, zoomAt, type View } from "../lib/geometry";
import { classColor } from "../lib/classes";

interface Props {
  imageUrl: string;
  width: number;
  height: number;
  components: Component[];
  texts: TextItem[];
  activeId: string | null;
  selectedId: string | null;
  assigning: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onPickComponent: (id: string) => void;
}

const MAX_ZOOM = 16;

export function Viewer(p: Props) {
  const { width, height, components, texts, activeId, selectedId, assigning } = p;
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const fitted = useRef(true);
  const fit = useRef(1);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const [panning, setPanning] = useState(false);

  const refit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const v = fitView(el.clientWidth, el.clientHeight, width, height);
    fit.current = v.scale;
    setView(v);
    fitted.current = true;
  }, [width, height]);

  useLayoutEffect(() => {
    refit();
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const v = fitView(el.clientWidth, el.clientHeight, width, height);
      fit.current = v.scale;
      if (fitted.current) setView(v);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [refit, width, height]);

  const zoom = useCallback((factor: number, px?: number, py?: number) => {
    const el = box.current;
    if (!el) return;
    const ax = px ?? el.clientWidth / 2;
    const ay = py ?? el.clientHeight / 2;
    fitted.current = false;
    setView((v) => zoomAt(v, factor, ax, ay, fit.current * 0.5, fit.current * MAX_ZOOM));
  }, []);

  // Wheel needs a non-passive listener to prevent the page from scrolling while zooming.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      setPanning(true);
      box.current?.setPointerCapture(e.pointerId);
    }
    fitted.current = false;
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const endDrag = () => {
    setPanning(false);
    // keep `moved` until the click that follows pointerup has been swallowed
    setTimeout(() => (drag.current = null), 0);
  };
  const clickAllowed = () => !drag.current?.moved;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = 60;
    const pan = (dx: number, dy: number) => {
      fitted.current = false;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    };
    switch (e.key) {
      case "+":
      case "=":
        return zoom(1.25);
      case "-":
        return zoom(0.8);
      case "0":
        return refit();
      case "ArrowLeft":
        return pan(step, 0);
      case "ArrowRight":
        return pan(-step, 0);
      case "ArrowUp":
        return pan(0, step);
      case "ArrowDown":
        return pan(0, -step);
    }
  };

  const related = useMemo(() => pairIds(activeId, texts), [activeId, texts]);
  const byId = useMemo(() => new Map(components.map((c) => [c.id, c])), [components]);
  const s = view.scale;
  const fs = 12 / s;
  const usedClasses = useMemo(() => [...new Set(components.map((c) => c.cls))].sort(), [components]);

  return (
    <div className="viewer-wrap">
      <div
        ref={box}
        className={`viewer${panning ? " panning" : ""}${assigning ? " assigning" : ""}`}
        style={{ "--ar": `${width} / ${height}` } as React.CSSProperties}
        tabIndex={0}
        role="application"
        aria-label="Circuit image viewer. Plus and minus zoom, zero fits to screen, arrow keys pan."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        data-testid="viewer"
      >
        <div
          className="stage"
          style={{ width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${s})` }}
        >
          <img src={p.imageUrl} alt="Uploaded circuit drawing" width={width} height={height} draggable={false} />
          <svg
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            role="img"
            aria-label={`Detections: ${components.length} components, ${texts.length} text boxes`}
            data-testid="overlay"
          >
            <g className="links">
              {texts.map((t) => {
                const c = t.component_id ? byId.get(t.component_id) : undefined;
                if (!c) return null;
                const [x1, y1] = center(t.box);
                const [x2, y2] = center(c.box);
                const hot = related.has(t.id);
                return (
                  <line
                    key={t.id}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    className={`link${hot ? " hot" : ""}${p.activeId && !hot ? " dim" : ""}`}
                    data-testid={`link-${t.id}`}
                  />
                );
              })}
            </g>
            {components.map((c) => {
              const color = classColor(c.cls);
              const hot = related.has(c.id);
              const sel = selectedId === c.id;
              return (
                <g key={c.id} className={`box comp${hot ? " hot" : ""}${sel ? " sel" : ""}${activeId && !hot ? " dim" : ""}${assigning ? " pick" : ""}`} data-testid="comp-box" data-id={c.id}>
                  <rect
                    x={c.box[0]}
                    y={c.box[1]}
                    width={c.box[2] - c.box[0]}
                    height={c.box[3] - c.box[1]}
                    style={{ stroke: color, fill: color }}
                    onPointerEnter={() => p.onHover(c.id)}
                    onPointerLeave={() => p.onHover(null)}
                    onClick={() => clickAllowed() && (assigning ? p.onPickComponent(c.id) : p.onSelect(c.id))}
                  />
                  <text x={c.box[0]} y={c.box[1] - 4 / s} fontSize={fs} style={{ fill: color }} className="label" strokeWidth={3 / s}>
                    {c.cls}
                  </text>
                </g>
              );
            })}
            {texts.map((t) => {
              const hot = related.has(t.id);
              const sel = selectedId === t.id;
              return (
                <g key={t.id} className={`box txt${hot ? " hot" : ""}${sel ? " sel" : ""}${activeId && !hot ? " dim" : ""}`} data-testid="text-box" data-id={t.id}>
                  <rect
                    x={t.box[0]}
                    y={t.box[1]}
                    width={t.box[2] - t.box[0]}
                    height={t.box[3] - t.box[1]}
                    onPointerEnter={() => p.onHover(t.id)}
                    onPointerLeave={() => p.onHover(null)}
                    onClick={() => clickAllowed() && p.onSelect(t.id)}
                  />
                  <text x={t.box[0]} y={t.box[3] + fs + 2 / s} fontSize={fs} className="label value" strokeWidth={3 / s}>
                    {t.value ?? t.text}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="viewer-controls" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => zoom(1.25)} aria-label="Zoom in" title="Zoom in (+)">+</button>
          <button type="button" onClick={() => zoom(0.8)} aria-label="Zoom out" title="Zoom out (-)">&minus;</button>
          <button type="button" onClick={refit} aria-label="Fit to screen" title="Fit to screen (0)">Fit</button>
        </div>
        {assigning && <div className="viewer-banner">Click a component to attach the selected value</div>}
      </div>
      <ul className="legend" aria-label="Class colours">
        {usedClasses.map((c) => (
          <li key={c}>
            <span className="swatch" style={{ background: classColor(c) }} />
            {c}
          </li>
        ))}
        <li>
          <span className="swatch dashed" />
          text / value
        </li>
      </ul>
    </div>
  );
}
