import { useMemo, useState } from "react";
import type { ClassRow } from "../types";
import { metrics, num, pct, sortRows, type Split } from "../lib/metrics";
import { familyOf } from "../lib/classes";

type SortKey = keyof ClassRow;
const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "class", label: "Class", numeric: false },
  { key: "n_gt", label: "Instances", numeric: true },
  { key: "P", label: "P", numeric: true },
  { key: "R", label: "R", numeric: true },
  { key: "AP50", label: "AP50", numeric: true },
  { key: "AP50-95", label: "AP50-95", numeric: true },
];

const className = (c: string): string => (c === "text" ? "text (values)" : c);

export function MetricsTab() {
  const [split, setSplit] = useState<Split>("test");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "AP50-95", dir: "desc" });
  const det = metrics.detection[split];
  const e2e = metrics.values[split]["end to end"];
  const reader = metrics.values[split]["reader (ground-truth crops)"];
  const rows = useMemo(() => sortRows(metrics.perClass[split], sort.key, sort.dir), [split, sort]);
  const byAp = useMemo(() => sortRows(metrics.perClass[split], "AP50-95", "desc"), [split]);
  const history = metrics.values.val["reader history"];

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "class" ? "asc" : "desc" }));

  return (
    <div className="metrics">
      <div className="metrics-head">
        <div>
          <h2>Model metrics</h2>
          <p className="muted">
            Measured on the held-out {split === "test" ? "test" : "validation"} split of the training notebook
            ({det.components.conf.toFixed(3)} / {det.text.conf.toFixed(3)} confidence thresholds). Read from the bundled results files.
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Split">
          {(["test", "val"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={split === s} onClick={() => setSplit(s)}>
              {s === "test" ? "Test" : "Validation"}
            </button>
          ))}
        </div>
      </div>

      <div className="cards">
        <Card
          hero
          label="End-to-end values"
          value={pct(e2e["found, read and attached"])}
          hint={`Share of the ${e2e.texts} handwritten values found (${pct(e2e.found)}), read correctly and attached to the right component.`}
        />
        <Card label="Component mAP50" value={num(det.components.mAP50)} hint="Boxes overlapping the truth by 50% or more" />
        <Card label="Component mAP50-95" value={num(det.components["mAP50-95"])} hint="Stricter: averaged over 50% to 95% overlap" />
        <Card label="Text AP50" value={num(det.text.AP50)} hint="How well value boxes are located" />
        <Card label="Reader exact match" value={pct(reader["exact match"])} hint={`Crop read exactly right, CER ${num(reader.CER)}`} />
      </div>

      <div className="metrics-grid">
        <section className="card-block">
          <h3>Per-class AP50-95</h3>
          <p className="muted small">Ranked, {split === "test" ? "test" : "validation"} split. The table below has the same numbers.</p>
          <BarChart rows={byAp} />
        </section>
        <section className="card-block">
          <h3>Reader exact match per epoch</h3>
          <p className="muted small">Validation split, one point per epoch.</p>
          <HistoryChart history={history} />
          <table className="data compact">
            <thead>
              <tr>
                <th scope="col">Epoch</th>
                <th scope="col" className="num">Train loss</th>
                <th scope="col" className="num">Exact match</th>
                <th scope="col" className="num">CER</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.epoch}>
                  <td>{h.epoch}</td>
                  <td className="num">{h["train loss"].toFixed(4)}</td>
                  <td className="num">{pct(h["exact match"])}</td>
                  <td className="num">{h.CER.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card-block">
        <h3>Per-class results</h3>
        <div className="table-scroll">
          <table className="data" data-testid="class-table">
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={c.numeric ? "num" : ""}
                    aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button type="button" className="sort" onClick={() => toggleSort(c.key)}>
                      {c.label}
                      <span aria-hidden="true">{sort.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.class}>
                  <th scope="row">
                    <span
                      className="swatch"
                      style={r.class === "text" ? undefined : { background: `var(--cat-${familyOf(r.class).slot})` }}
                      data-dashed={r.class === "text"}
                    />
                    {className(r.class)}
                  </th>
                  <td className="num">{r.n_gt}</td>
                  <td className="num">{num(r.P)}</td>
                  <td className="num">{num(r.R)}</td>
                  <td className="num">{num(r.AP50)}</td>
                  <td className="num">{num(r["AP50-95"])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

type History = { epoch: number; "train loss": number; "exact match": number; CER: number }[];

function Card(p: { label: string; value: string; hint?: string; hero?: boolean }) {
  return (
    <div className={`stat${p.hero ? " hero" : ""}`}>
      <div className="stat-label">{p.label}</div>
      <div className="stat-value">{p.value}</div>
      {p.hint && <div className="stat-hint">{p.hint}</div>}
    </div>
  );
}

/** One series, one colour, bars ranked by value. The text row is muted: it is not a component class. */
function BarChart({ rows }: { rows: ClassRow[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560;
  const L = 112;
  const R = 44;
  const rowH = 24;
  const barH = 14;
  const top = 4;
  const plotH = rows.length * rowH;
  const H = top + plotH + 22;
  const x = (v: number) => L + v * (W - L - R);
  const cur = hover === null ? null : rows[hover];
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Bar chart of AP50-95 per class, ranked" data-testid="bar-chart">
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line x1={x(g)} x2={x(g)} y1={top} y2={top + plotH} className="grid" />
            <text x={x(g)} y={top + plotH + 15} textAnchor="middle" className="axis tick">
              {g === 0 ? "0" : g === 1 ? "1" : g.toFixed(2).replace(/0$/, "")}
            </text>
          </g>
        ))}
        <line x1={L} x2={L} y1={top} y2={top + plotH} className="baseline" />
        {rows.map((r, i) => {
          const y = top + i * rowH;
          const w = Math.max(0, x(r["AP50-95"]) - L);
          const rad = Math.min(4, w / 2);
          const by = y + (rowH - barH) / 2;
          // Square at the baseline, 4px rounded at the data end.
          const d = `M${L} ${by}h${w - rad}a${rad} ${rad} 0 0 1 ${rad} ${rad}v${barH - 2 * rad}a${rad} ${rad} 0 0 1 ${-rad} ${rad}h${-(w - rad)}z`;
          return (
            <g
              key={r.class}
              className={`bar-row${hover === i ? " on" : ""}`}
              tabIndex={0}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${className(r.class)}: AP50-95 ${num(r["AP50-95"])}`}
            >
              <rect x={0} y={y} width={W} height={rowH} className="hit" />
              <text x={L - 8} y={y + 16} textAnchor="end" className="axis">{className(r.class)}</text>
              <path d={d} className={r.class === "text" ? "bar muted" : "bar"} />
              <text x={x(r["AP50-95"]) + 6} y={y + 16} className="axis value">{num(r["AP50-95"])}</text>
            </g>
          );
        })}
      </svg>
      {cur && hover !== null && (
        <div className="tip" style={{ top: `${((top + hover * rowH) / H) * 100}%` }} role="status">
          <strong className="mono">{num(cur["AP50-95"])}</strong> AP50-95
          <span className="tip-name">{className(cur.class)}</span>
          <span className="muted mono">AP50 {num(cur.AP50)} &middot; n {cur.n_gt}</span>
        </div>
      )}
    </div>
  );
}

/** One series: no legend, the heading names it. Crosshair snaps to the nearest epoch. */
function HistoryChart({ history }: { history: History }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 480;
  const H = 170;
  const pad = { l: 52, r: 24, t: 22, b: 26 };
  const vals = history.map((h) => h["exact match"]);
  const vmin = Math.min(...vals);
  const vmax = Math.max(...vals);
  const span = vmax - vmin || 0.01;
  const lo = vmin - span * 0.15;
  const hi = vmax + span * 0.15;
  const n = history.length;
  const last = n - 1;
  const x = (i: number) => pad.l + (n === 1 ? 0.5 : i / (n - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const d = history.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(h["exact match"]).toFixed(1)}`).join(" ");
  // Ticks sit at values the series actually reaches.
  const ticks = [...new Set([vmin, (vmin + vmax) / 2, vmax].map((v) => Number(v.toFixed(4))))];
  const cur = hover === null ? null : history[hover];
  const lastValue = history[last]?.["exact match"] ?? 0;

  const nearest = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - r.left) / (r.width || 1);
    setHover(Math.min(last, Math.max(0, Math.round(f * last))));
  };

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Line chart of reader exact match per epoch" data-testid="history-chart">
        {ticks.map((g) => (
          <g key={g}>
            <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} className="grid" />
            <text x={pad.l - 6} y={y(g) + 4} textAnchor="end" className="axis tick">{pct(g, 1)}</text>
          </g>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="crosshair" />}
        <path d={d} className="line" />
        {history.map((h, i) => (
          <g key={h.epoch}>
            <circle cx={x(i)} cy={y(h["exact match"])} r={i === last || i === hover ? 6 : 4.5} className={`dot${i === last ? " last" : ""}`} />
            <text x={x(i)} y={H - 7} textAnchor="middle" className="axis tick">{h.epoch}</text>
          </g>
        ))}
        <text x={x(last)} y={y(lastValue) - 11} textAnchor="end" className="axis value">{pct(lastValue, 1)}</text>
        <rect
          x={pad.l}
          y={pad.t}
          width={W - pad.l - pad.r}
          height={H - pad.t - pad.b}
          className="hit"
          onPointerMove={nearest}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {cur && hover !== null && (
        <div className="tip" style={{ left: `${(x(hover) / W) * 100}%`, top: 0 }} role="status">
          <strong className="mono">{pct(cur["exact match"], 1)}</strong> exact match
          <span className="tip-name">Epoch {cur.epoch}</span>
          <span className="muted mono">CER {cur.CER.toFixed(3)}</span>
        </div>
      )}
    </div>
  );
}
