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

export interface CountyDistribution {
  n_loans: number;
  simple_mean_pct?: number;
  amount_weighted_mean_pct?: number;
  p10_pct?: number;
  p25_pct?: number;
  p50_pct?: number;
  p75_pct?: number;
  p90_pct?: number;
  low_n?: boolean;
}

export interface CountyEntry {
  fips: string;
  name: string;
  term_15: CountyDistribution;
  term_30: CountyDistribution;
}

export interface CountiesFile {
  state_slug: string;
  state_postal: string;
  state_fips: string;
  source: string;
  low_n_threshold: number;
  counties: CountyEntry[];
}

export interface MndTodayPoint {
  rate_pct: number;
  as_of_iso: string | null;
}

export interface DemographicBucket {
  bucket: string;
  n_loans: number;
  simple_mean_pct?: number;
  amount_weighted_mean_pct?: number;
  p10_pct?: number;
  p25_pct?: number;
  p50_pct?: number;
  p75_pct?: number;
  p90_pct?: number;
  low_n?: boolean;
}

export interface DemographicsByTerm {
  race: DemographicBucket[];
  ethnicity: DemographicBucket[];
  sex: DemographicBucket[];
  loan_amount: DemographicBucket[];
}

export interface HmdaDemographicsFile {
  state_slug: string;
  state_postal: string;
  built_at_utc: string;
  term_15: DemographicsByTerm;
  term_30: DemographicsByTerm;
}

export interface MndTodayFile {
  fetched_at_utc: string;
  as_of_raw: string | null;
  as_of_iso: string | null;
  term_15: MndTodayPoint;
  term_30: MndTodayPoint;
}

export interface DailyRatePoint {
  date: string;
  rate: number;
  src: string;
}
