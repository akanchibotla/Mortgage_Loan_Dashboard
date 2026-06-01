import { useEffect } from "react";

interface PageMeta {
  title: string;
  description?: string;
  canonical?: string;
}

const BASE_TITLE = "Mortgage rates by state, with HMDA county data";
const DEFAULT_DESC =
  "Self-updating U.S. mortgage rate dashboard. Today's Bankrate + Mortgage News Daily quotes alongside the actual HMDA 2024 closed-loan distribution for every state and county. Includes a borrower expectation calculator.";

function setMetaName(name: string, content: string) {
  let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setMetaProperty(prop: string, content: string) {
  let el = document.querySelector(`meta[property="${prop}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", prop);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href: string) {
  let el = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

export function usePageMeta(meta: PageMeta) {
  useEffect(() => {
    const fullTitle = meta.title === BASE_TITLE ? meta.title : `${meta.title} | ${BASE_TITLE}`;
    document.title = fullTitle;
    const desc = meta.description ?? DEFAULT_DESC;
    setMetaName("description", desc);
    setMetaProperty("og:title", fullTitle);
    setMetaProperty("og:description", desc);
    setMetaProperty("og:type", "website");
    setMetaName("twitter:card", "summary_large_image");
    setMetaName("twitter:title", fullTitle);
    setMetaName("twitter:description", desc);
    if (meta.canonical) {
      setCanonical(meta.canonical);
    }
  }, [meta.title, meta.description, meta.canonical]);
}

export { BASE_TITLE, DEFAULT_DESC };
