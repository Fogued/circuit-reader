import { useId, useState } from "react";

/**
 * Extra detail that must not depend on hover: a button that toggles visible text. Works with keyboard
 * (Enter/Space, Escape closes) and touch.
 */
export function Disclosure(p: { label: string; text: string; testId?: string; className?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className={`disclosure${p.className ? ` ${p.className}` : ""}`}>
      <button
        type="button"
        className="disc-btn"
        aria-expanded={open}
        aria-controls={id}
        data-testid={p.testId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        {p.label}
      </button>
      <span id={id} className="disc-pop" hidden={!open}>
        {p.text}
      </span>
    </span>
  );
}
