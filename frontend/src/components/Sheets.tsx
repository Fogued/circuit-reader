import type { DemoEntry } from "../types";

/** The bundled examples as a set of sheets: text tabs, the open one underlined. */
export function Sheets(p: { gallery: DemoEntry[]; currentId: string | null; onOpen: (e: DemoEntry) => void }) {
  if (p.gallery.length === 0) return null;
  return (
    <nav className="sheets" aria-label="Sheets">
      {p.gallery.map((e, i) => (
        <button
          key={e.id}
          type="button"
          className="sheet-tab"
          aria-current={e.id === p.currentId ? "true" : undefined}
          onClick={() => p.onOpen(e)}
        >
          <span className="sheet-no">Sheet {i + 1}</span>
          <span className="sheet-title">{e.title}</span>
        </button>
      ))}
    </nav>
  );
}
