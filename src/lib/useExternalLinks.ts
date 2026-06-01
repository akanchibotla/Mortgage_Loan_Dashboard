import { useEffect } from "react";

/**
 * Global click delegate: any anchor whose href points to a different origin
 * gets `target="_blank" rel="noopener noreferrer"` applied at click time so
 * the navigation opens in a new tab.
 *
 * Internal React Router <Link> components render anchors with relative or
 * same-origin hrefs and are untouched — they keep their default in-tab SPA
 * navigation behavior.
 */
export function useExternalLinks() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      // Only outbound http(s) URLs.
      if (!/^https?:\/\//i.test(href)) return;
      try {
        const url = new URL(href);
        if (url.origin === window.location.origin) return; // same site
      } catch {
        return;
      }
      anchor.setAttribute("target", "_blank");
      const rel = anchor.getAttribute("rel") ?? "";
      const needed = ["noopener", "noreferrer"];
      const parts = new Set(rel.split(/\s+/).filter(Boolean));
      for (const n of needed) parts.add(n);
      anchor.setAttribute("rel", Array.from(parts).join(" "));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}
