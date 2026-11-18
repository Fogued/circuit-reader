export type Mode = "checking" | "live" | "demo";
export type Tab = "review" | "metrics";

const REPO = "https://github.com/Fogued/circuit-reader";

export function Header(p: { mode: Mode; detail?: string | null; tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <header className="header">
      <div className="header-row">
        <div className="brand">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="7" className="logo-bg" />
            <path d="M4 16h6l2-6 4 12 3-9 2 3h7" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h1>Circuit Reader Studio</h1>
          <span
            className={`badge ${p.mode}`}
            data-testid="mode-badge"
            title={
              p.mode === "live"
                ? "Connected to the model backend"
                : p.mode === "checking"
                  ? "Waiting for the backend, the models may still be loading"
                  : (p.detail ?? "No backend: bundled example only")
            }
          >
            {p.mode === "live" ? "Live model" : p.mode === "demo" ? "Demo" : "Connecting to model…"}
          </span>
        </div>
        <nav className="links" aria-label="Project links">
          <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
          <a href={`${REPO}/blob/main/circuit-reader.ipynb`} target="_blank" rel="noreferrer">Notebook</a>
        </nav>
      </div>
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
    </header>
  );
}
