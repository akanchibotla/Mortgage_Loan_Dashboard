import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Per-source identity used by the rate chart's series-visibility toggle.
// Future sources (Phase 3 Rocket Mortgage, etc.) extend this union and the
// ALL_SOURCES list below; no other code needs to change.
export type ChartSourceId =
  | "pmms"
  | "bankrate"
  | "mnd"
  | "nerdwallet"
  | "hmda";

const ALL_SOURCES: ChartSourceId[] = ["pmms", "bankrate", "mnd", "nerdwallet", "hmda"];

interface ChartToggleValue {
  isVisible: (id: ChartSourceId) => boolean;
  toggle: (id: ChartSourceId) => void;
  visibleSet: Set<ChartSourceId>;
}

const ALL_VISIBLE_FALLBACK: Set<ChartSourceId> = new Set(ALL_SOURCES);
const FALLBACK: ChartToggleValue = {
  isVisible: () => true,
  toggle: () => {},
  visibleSet: ALL_VISIBLE_FALLBACK,
};

const ChartToggleContext = createContext<ChartToggleValue | null>(null);

export function ChartToggleProvider({ children }: { children: ReactNode }) {
  const [visibleSet, setVisibleSet] = useState<Set<ChartSourceId>>(
    () => new Set(ALL_SOURCES),
  );
  const toggle = useCallback((id: ChartSourceId) => {
    setVisibleSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const isVisible = useCallback(
    (id: ChartSourceId) => visibleSet.has(id),
    [visibleSet],
  );
  const value = useMemo<ChartToggleValue>(
    () => ({ visibleSet, toggle, isVisible }),
    [visibleSet, toggle, isVisible],
  );
  return (
    <ChartToggleContext.Provider value={value}>
      {children}
    </ChartToggleContext.Provider>
  );
}

// Returns a no-op "all visible" fallback when called outside a provider, so
// the chart still renders correctly on pages that don't mount the scope
// wrapper (e.g. the calculator preview chart).
export function useChartToggles(): ChartToggleValue {
  return useContext(ChartToggleContext) ?? FALLBACK;
}
