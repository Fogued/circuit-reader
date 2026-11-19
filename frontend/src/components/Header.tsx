export type Tab = "review" | "metrics";

const REPO = "https://github.com/Fogued/circuit-reader";
const NOTEBOOK = "https://www.kaggle.com/code/diegofogued/circuit-reader";

export function Header(p: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <header className="header">
      <h1 className="brand">Circuit Reader</h1>
      <div className="tabs" role="tablist" aria-label="Sections">
        {(["review", "metrics"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={p.tab === t}
            aria-controls={`panel-${t}`}
            tabIndex={p.tab === t ? 0 : -1}
            onClick={() => p.onTab(t)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                p.onTab(t === "review" ? "metrics" : "review");
                document.getElementById(`tab-${t === "review" ? "metrics" : "review"}`)?.focus();
              }
            }}
          >
            {t === "review" ? "Review" : "Metrics"}
          </button>
        ))}
      </div>
      <nav className="links" aria-label="Project links">
        <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
        <a href={NOTEBOOK} target="_blank" rel="noreferrer">Kaggle</a>
      </nav>
      <p className="tagline">
        Reads component values from hand-drawn circuit diagrams. A person checks what it found, corrects it and exports the labels.
      </p>
    </header>
  );
}
