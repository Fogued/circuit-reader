import { useId, useLayoutEffect, useRef, useState } from "react";

/**
 * Extra detail that must not depend on hover: a button that toggles visible text. Works with keyboard
 * (Enter/Space, Escape closes) and touch.
 */
export function Disclosure(p: { label: string; text: string; testId?: string; className?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const pop = useRef<HTMLSpanElement>(null);
  // Keep the popover inside the viewport: shift it left when it would run past the right edge.
  useLayoutEffect(() => {
    const el = pop.current;
    if (!el) return;
    el.style.transform = "";
    if (!open) return;
    const over = el.getBoundingClientRect().right - (window.innerWidth - 16);
    if (over > 0) el.style.transform = `translateX(-${Math.ceil(over)}px)`;
  }, [open]);
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
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {p.label}
      </button>
      <span id={id} ref={pop} className="disc-pop" hidden={!open}>
        {p.text}
      </span>
    </span>
  );
}
