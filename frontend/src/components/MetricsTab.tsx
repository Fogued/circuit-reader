import { useMemo, useState } from "react";
import type { ClassRow } from "../types";
import { metrics, num, pct, sortRows, type Split } from "../lib/metrics";
import { classColor } from "../lib/classes";

type SortKey = keyof ClassRow;
const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "class", label: "Class", numeric: false },
  { key: "n_gt", label: "Instances", numeric: true },
  { key: "P", label: "P", numeric: true },
  { key: "R", label: "R", numeric: true },
  { key: "AP50", label: "AP50", numeric: true },
  { key: "AP50-95", label: "AP50-95", numeric: true },
];

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
        <Card label="Component mAP50" value={num(det.components.mAP50)} />
        <Card label="Component mAP50-95" value={num(det.components["mAP50-95"])} />
        <Card label="Text AP50" value={num(det.text.AP50)} />
        <Card label="End-to-end values" value={pct(e2e["found, read and attached"])} hint="found, read and attached" accent />
        <Card label="Reader exact match" value={pct(reader["exact match"])} hint={`CER ${num(reader.CER)} (ground-truth crops)`} />
        <Card label="Text found" value={pct(e2e.found)} hint={`${e2e.texts} text boxes`} />
      </div>

      <div className="metrics-grid">
        <section className="card-block">
          <h3>Per-class AP50-95</h3>
          <BarChart rows={byAp} />
        </section>
        <section className="card-block">
          <h3>Reader history</h3>
          <p className="muted small">Exact match per epoch on the validation split.</p>
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
                    <span className="swatch" style={r.class === "text" ? undefined : { background: classColor(r.class) }} data-dashed={r.class === "text"} />
                    {r.class}
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

function Card(p: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className={`stat${p.accent ? " accent" : ""}`}>
      <div className="stat-label">{p.label}</div>
      <div className="stat-value">{p.value}</div>
      {p.hint && <div className="stat-hint">{p.hint}</div>}
    </div>
  );
}

function BarChart({ rows }: { rows: ClassRow[] }) {
  const W = 560;
  const L = 124;
  const R = 44;
  const rowH = 22;
  const H = rows.length * rowH + 8;
  const x = (v: number) => L + v * (W - L - R);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Bar chart of AP50-95 per class" data-testid="bar-chart">
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line x1={x(g)} x2={x(g)} y1={0} y2={H - 8} className="grid" />
        </g>
      ))}
      {rows.map((r, i) => {
        const y = 4 + i * rowH;
        return (
          <g key={r.class}>
            <text x={L - 8} y={y + 13} textAnchor="end" className="axis">{r.class}</text>
            <rect
              x={L}
              y={y + 2}
              width={Math.max(0, x(r["AP50-95"]) - L)}
              height={rowH - 7}
              rx={2}
              style={{ fill: r.class === "text" ? "var(--muted)" : classColor(r.class) }}
            />
            <text x={x(r["AP50-95"]) + 6} y={y + 13} className="axis value">{num(r["AP50-95"])}</text>
          </g>
        );
      })}
    </svg>
  );
}

function HistoryChart({ history }: { history: { epoch: number; "exact match": number }[] }) {
  const W = 320;
  const H = 120;
  const pad = { l: 40, r: 12, t: 10, b: 22 };
  const vals = history.map((h) => h["exact match"]);
  const lo = Math.floor((Math.min(...vals) - 0.005) * 100) / 100;
  const hi = Math.ceil((Math.max(...vals) + 0.005) * 100) / 100;
  const n = history.length;
  const x = (i: number) => pad.l + (n === 1 ? 0.5 : i / (n - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const d = history.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(h["exact match"]).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Line chart of reader exact match per epoch">
      {[lo, (lo + hi) / 2, hi].map((g) => (
        <g key={g}>
          <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} className="grid" />
          <text x={pad.l - 6} y={y(g) + 4} textAnchor="end" className="axis">{pct(g, 0)}</text>
        </g>
      ))}
      <path d={d} className="line" />
      {history.map((h, i) => (
        <g key={h.epoch}>
          <circle cx={x(i)} cy={y(h["exact match"])} r={3.5} className="dot" />
          <text x={x(i)} y={H - 6} textAnchor="middle" className="axis">{h.epoch}</text>
        </g>
      ))}
    </svg>
  );
}
