import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Width of an element in CSS pixels, kept current with a ResizeObserver. Charts draw at this width so their
 * text stays at its real size instead of being scaled down with a viewBox. `fallback` is used until the
 * element has a measurable size (first paint, tests without layout).
 */
export function useElementWidth<T extends HTMLElement>(fallback = 560): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.round(el.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width > 0 ? width : fallback];
}
