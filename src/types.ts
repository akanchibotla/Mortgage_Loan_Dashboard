export interface MonthlyRate {
  month: string;
  rate: number;
  n_weeks: number;
}

export interface NcMonthlySnapshot {
  m: string;
  date: string;
  rate: number | null;
  src: string;
}

export interface HmdaSummary {
  source: string;
  n_loans: number;
  simple_mean_pct: number;
  amount_weighted_mean_pct: number;
  p10_pct: number;
  p25_pct: number;
  p50_pct: number;
  p75_pct: number;
  p90_pct: number;
}

export interface ChartPoint {
  x: string;
  y: number | null;
  src?: string;
}

export interface MndTodayPoint {
  rate_pct: number;
  as_of_iso: string | null;
}

export interface MndTodayFile {
  fetched_at_utc: string;
  as_of_raw: string | null;
  as_of_iso: string | null;
  term_15: MndTodayPoint;
  term_30: MndTodayPoint;
}
