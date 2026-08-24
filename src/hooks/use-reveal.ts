import { useEffect, useRef } from "react";

/**
 * Scroll-reveal hook: attaches an IntersectionObserver and adds the
 * `reveal-visible` class the first time the element enters the viewport.
 * Pair with the `.reveal` CSS class. Falls back to visible immediately
 * when IntersectionObserver is unavailable.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(threshold = 0.2) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("reveal-visible");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("reveal-visible");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  return ref;
}
