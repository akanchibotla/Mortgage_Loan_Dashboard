import type {
  CountiesFile,
  HmdaDemographicsFile,
  HmdaSummary,
  MonthlyRate,
  NcMonthlySnapshot,
} from "../types";

// Eager: state_meta.json files for every bundled state. Tiny (~200B each).
// Used by the home page to list available states without loading their full
// time-series JSON.
const metaFiles = import.meta.glob("../data/states/*/state_meta.json", {
  eager: true,
  import: "default",
}) as Record<string, StateMeta>;

// Eager: national PMMS series shared across all state pages.
const pmmsFiles = import.meta.glob("../data/pmms_*_monthly.json", {
  eager: true,
  import: "default",
}) as Record<string, MonthlyRate[]>;

// Lazy: per-state time-series + HMDA JSON. Each route loader fetches just
// its own state's files via dynamic import — Vite chunks them per state.
const stateLoaders = import.meta.glob("../data/states/*/*.json", {
  import: "default",
}) as Record<string, () => Promise<unknown>>;

export interface StateData {
  slug: string;
  meta: StateMeta;
  bankrate15: NcMonthlySnapshot[] | null;
  bankrate30: NcMonthlySnapshot[] | null;
  mnd15: NcMonthlySnapshot[] | null;
  mnd30: NcMonthlySnapshot[] | null;
  hmda15?: HmdaSummary;
  hmda30?: HmdaSummary;
  counties?: CountiesFile;
  demographics?: HmdaDemographicsFile;
}

export interface StateMeta {
  slug: string;
  postal: string;
  fips: string;
  name: string;
  built_at_utc: string;
  has_hmda_band: boolean;
  live_trailing: boolean;
}

export interface StateRegistryEntry {
  slug: string;
  postal: string;
  fips: string;
  name: string;
  meta: StateMeta;
}

function metaForSlug(slug: string): StateMeta | undefined {
  return metaFiles[`../data/states/${slug}/state_meta.json`];
}

async function loadOptional<T>(slug: string, leaf: string): Promise<T | null> {
  const loader = stateLoaders[`../data/states/${slug}/${leaf}`];
  if (!loader) return null;
  return (await loader()) as T;
}

export async function loadStateData(slug: string): Promise<StateData | null> {
  const meta = metaForSlug(slug);
  if (!meta) return null;
  const [bankrate15, bankrate30, mnd15, mnd30, hmda15, hmda30, counties, demographics] =
    await Promise.all([
      loadOptional<NcMonthlySnapshot[]>(slug, "bankrate_15yr.json"),
      loadOptional<NcMonthlySnapshot[]>(slug, "bankrate_30yr.json"),
      loadOptional<NcMonthlySnapshot[]>(slug, "mnd_15yr.json"),
      loadOptional<NcMonthlySnapshot[]>(slug, "mnd_30yr.json"),
      loadOptional<HmdaSummary>(slug, "hmda_2024_15yr.json"),
      loadOptional<HmdaSummary>(slug, "hmda_2024_30yr.json"),
      loadOptional<CountiesFile>(slug, "counties.json"),
      loadOptional<HmdaDemographicsFile>(slug, "hmda_2024_demographics.json"),
    ]);
  return {
    slug,
    meta,
    bankrate15,
    bankrate30,
    mnd15,
    mnd30,
    hmda15: hmda15 ?? undefined,
    hmda30: hmda30 ?? undefined,
    counties: counties ?? undefined,
    demographics: demographics ?? undefined,
  };
}

export function loadStateRegistry(): StateRegistryEntry[] {
  const entries: StateRegistryEntry[] = [];
  for (const [path, meta] of Object.entries(metaFiles)) {
    if (!path.endsWith("/state_meta.json")) continue;
    entries.push({
      slug: meta.slug,
      postal: meta.postal,
      fips: meta.fips,
      name: meta.name,
      meta,
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export function loadPmms() {
  return {
    pmms15: pmmsFiles["../data/pmms_15yr_monthly.json"],
    pmms30: pmmsFiles["../data/pmms_30yr_monthly.json"],
  };
}

export interface StatesIndexEntry {
  slug: string;
  postal: string;
  fips: string;
  name: string;
  has_hmda_band: boolean;
  has_counties?: boolean;
  n_counties?: number;
  n_loans_hmda?: number;
  live_trailing: boolean;
  latest_15: number | null;
  latest_15_month: string | null;
  latest_30: number | null;
  latest_30_month: string | null;
}

import statesIndex from "../data/states_index.json";

export function loadStatesIndex(): { built_at_utc: string; states: StatesIndexEntry[] } {
  return statesIndex as { built_at_utc: string; states: StatesIndexEntry[] };
}
