import type { HmdaSummary, MonthlyRate, NcMonthlySnapshot } from "../types";

// Eager glob: every JSON file under src/data/states/<slug>/ is included at build time.
// At v2 scale this is small (50 states × ~5 files × ~3KB = ~750KB).
const allFiles = import.meta.glob("../data/states/*/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

export interface StateData {
  slug: string;
  meta?: StateMeta;
  bankrate15: NcMonthlySnapshot[] | null;
  bankrate30: NcMonthlySnapshot[] | null;
  mnd15: NcMonthlySnapshot[] | null;
  mnd30: NcMonthlySnapshot[] | null;
  hmda15?: HmdaSummary;
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

function fileFor(slug: string, leaf: string): unknown | undefined {
  const key = `../data/states/${slug}/${leaf}`;
  return allFiles[key];
}

export function loadStateData(slug: string): StateData {
  return {
    slug,
    meta: fileFor(slug, "state_meta.json") as StateMeta | undefined,
    bankrate15: (fileFor(slug, "bankrate_15yr.json") as NcMonthlySnapshot[]) ?? null,
    bankrate30: (fileFor(slug, "bankrate_30yr.json") as NcMonthlySnapshot[]) ?? null,
    mnd15: (fileFor(slug, "mnd_15yr.json") as NcMonthlySnapshot[]) ?? null,
    mnd30: (fileFor(slug, "mnd_30yr.json") as NcMonthlySnapshot[]) ?? null,
    hmda15: fileFor(slug, "hmda_2024_15yr.json") as HmdaSummary | undefined,
  };
}

export function loadStateRegistry(): StateRegistryEntry[] {
  const entries: StateRegistryEntry[] = [];
  for (const [path, value] of Object.entries(allFiles)) {
    if (!path.endsWith("/state_meta.json")) continue;
    const meta = value as StateMeta;
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
    pmms15: allFiles["../data/pmms_15yr_monthly.json"] as MonthlyRate[],
    pmms30: allFiles["../data/pmms_30yr_monthly.json"] as MonthlyRate[],
  };
}
