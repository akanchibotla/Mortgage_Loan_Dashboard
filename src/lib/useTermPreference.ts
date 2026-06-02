import { useState } from "react";

const STORAGE_KEY = "mld:term";

function readStoredTerm(): 15 | 30 {
  if (typeof window === "undefined") return 30;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "15" ? 15 : 30;
  } catch {
    return 30;
  }
}

function writeStoredTerm(term: 15 | 30) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(term));
  } catch {
    // localStorage may be unavailable (Safari private browsing, quota errors)
  }
}

export function useTermPreference(): [15 | 30, (term: 15 | 30) => void] {
  const [term, setTermState] = useState<15 | 30>(readStoredTerm);
  const setTerm = (next: 15 | 30) => {
    setTermState(next);
    writeStoredTerm(next);
  };
  return [term, setTerm];
}
