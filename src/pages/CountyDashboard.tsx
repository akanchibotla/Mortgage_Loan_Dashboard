import { Suspense, use, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { loadStateData, type StateData } from "../lib/loadStateData";
import { usePageMeta } from "../lib/usePageMeta";
import type { CountyEntry, HmdaSummary } from "../types";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { fmtRate } from "../lib/payment";

const cache = new Map<string, Promise<StateData | null>>();
function getStatePromise(slug: string): Promise<StateData | null> {
  let p = cache.get(slug);
  if (!p) {
    p = loadStateData(slug);
    cache.set(slug, p);
  }
  return p;
}

export default function CountyDashboard() {
  const { slug = "", countyFips = "" } = useParams<{ slug: string; countyFips: string }>();
  // Mirrors StateDashboard: the boundary sits OUTSIDE the Suspense so a
  // rejected loadStateData() promise renders a message instead of hanging on
  // the fallback forever.
  return (
    <ErrorBoundary label={`data for county ${countyFips}`}>
      <Suspense fallback={<p className="loading">Loading…</p>}>
        <CountyBody slug={slug} countyFips={countyFips} />
      </Suspense>
    </ErrorBoundary>
  );
}

function CountyBody({ slug, countyFips }: { slug: string; countyFips: string }) {
  const data = use(getStatePromise(slug));
  const county = data?.counties?.counties.find((c) => c.fips === countyFips);
  usePageMeta({
    title: county
      ? `${county.name} County, ${data!.meta.postal} mortgage rates`
      : `County ${countyFips}`,
    description: county
      ? `HMDA 2024 closed-loan distribution for ${county.name} County, ${data!.meta.postal}: middle 80% rate range from ${county.term_30.n_loans.toLocaleString()} closed 30-year loans plus ${county.term_15.n_loans.toLocaleString()} 15-year, vs the state aggregate.`
      : undefined,
  });
  if (!data) {
    return notFound(slug);
  }
  if (!data.counties) {
    return (
      <div>
        <Link to={`/state/${slug}`} className="county-back-link">
          <span aria-hidden="true">←</span> Back to {data.meta.name} dashboard
        </Link>
        <h1 className="county-page-h1">County data not bundled</h1>
        <p>
          {data.meta.name} doesn't have county-level HMDA bundled yet. (Currently only NC is
          partitioned; other states require the FFIEC bulk download.)
        </p>
      </div>
    );
  }
  if (!county) {
    return notFound(slug, countyFips, data.meta.name);
  }

  const stateHmda = data.hmda15;

  return (
    <>
      <Link to={`/state/${slug}`} className="county-back-link">
        <span aria-hidden="true">←</span> Back to {data.meta.name} dashboard
      </Link>
      <h1 className="county-page-h1">
        {county.name} County, {data.meta.postal}
      </h1>
      <p className="sub">
        HMDA 2024 closed-loan distribution for {county.name} County. {countyAggregateBlurb(county)}{" "}
        Use this to gauge what borrowers in your county actually paid vs. today's market quotes on the{" "}
        <Link to={`/state/${slug}`}>state dashboard</Link>.
      </p>

      <DistributionSection title="30-year fixed" county={county} term={30} stateHmda={stateHmda} />
      <DistributionSection title="15-year fixed" county={county} term={15} stateHmda={stateHmda} />

      <PeerComparison
        slug={slug}
        counties={data.counties.counties}
        currentFips={countyFips}
      />
    </>
  );
}

function DistributionSection({
  title,
  county,
  term,
  stateHmda,
}: {
  title: string;
  county: CountyEntry;
  term: 15 | 30;
  stateHmda?: HmdaSummary;
}) {
  const d = term === 15 ? county.term_15 : county.term_30;
  if (!d.n_loans) {
    return (
      <section className="section">
        <h2>{title}</h2>
        <p className="sub">No {term}-year closed loans recorded in {county.name} County for 2024.</p>
      </section>
    );
  }
  return (
    <section className="section">
      <h2>
        {title} — {county.name} <span className="muted">({d.n_loans.toLocaleString()} closed loans)</span>
        {d.low_n && <span className="state-tag" style={{ marginLeft: 8 }}>small sample</span>}
      </h2>
      <DistributionBar d={d} />
      <div className="kv-grid">
        <Stat k="best 10%" v={fmtRate(d.p10_pct)} />
        <Stat k="lower 25%" v={fmtRate(d.p25_pct)} />
        <Stat k="median" v={fmtRate(d.p50_pct)} />
        <Stat k="upper 25%" v={fmtRate(d.p75_pct)} />
        <Stat k="worst 10%" v={fmtRate(d.p90_pct)} />
        <Stat k="average rate" v={fmtRate(d.simple_mean_pct)} />
        <Stat k="average weighted by loan size" v={fmtRate(d.amount_weighted_mean_pct)} />
      </div>
      {term === 15 && stateHmda && (
        <p className="sub" style={{ marginTop: 12 }}>
          <b>vs state ({stateHmda.source.includes("NC") ? "NC" : "state"} aggregate):</b>{" "}
          county simple mean {fmtRate(d.simple_mean_pct)} vs state {fmtRate(stateHmda.simple_mean_pct)} —{" "}
          {compareBp(d.simple_mean_pct, stateHmda.simple_mean_pct)}.
        </p>
      )}
    </section>
  );
}

function DistributionBar({ d }: { d: CountyEntry["term_30"] }) {
  if (!d.p10_pct || !d.p90_pct) return null;
  // 4%–10% is the COMMON case, not a hard range: 184 county/term cells have a
  // p10 below 4 or a p90 above 10, and against a fixed track those bars were
  // painted outside it entirely (California Imperial started half a track-
  // width to the left of the axis). Widen to fit the data the way
  // DemographicsPanel already does, so every bar stays inside its own track
  // and the axis labels stay truthful about what the track shows.
  const RANGE_LO = Math.floor(Math.min(4, d.p10_pct));
  const RANGE_HI = Math.ceil(Math.max(10, d.p90_pct));
  const span = RANGE_HI - RANGE_LO;
  const pct = (v: number) => `${((v - RANGE_LO) / span) * 100}%`;
  const w = (a: number, b: number) => `${((b - a) / span) * 100}%`;
  return (
    <div className="dist-bar">
      <div className="dist-axis">
        {axisTicks(RANGE_LO, RANGE_HI).map((v) => (
          <span key={v} style={{ left: pct(v) }}>
            {v}%
          </span>
        ))}
      </div>
      <div className="dist-track">
        <div
          className="dist-band-outer"
          style={{ left: pct(d.p10_pct), width: w(d.p10_pct, d.p90_pct) }}
          title={`middle 80% of rates: ${d.p10_pct.toFixed(2)}%–${d.p90_pct.toFixed(2)}%`}
        />
        {d.p25_pct && d.p75_pct && (
          <div
            className="dist-band-inner"
            style={{ left: pct(d.p25_pct), width: w(d.p25_pct, d.p75_pct) }}
            title={`middle 50% of rates: ${d.p25_pct.toFixed(2)}%–${d.p75_pct.toFixed(2)}%`}
          />
        )}
        {d.p50_pct && (
          <div
            className="dist-median"
            style={{ left: pct(d.p50_pct) }}
            title={`median: ${d.p50_pct.toFixed(2)}%`}
          />
        )}
      </div>
    </div>
  );
}

// Whole-percent ticks across the resolved range. The old axis hardcoded
// [4..10]; once the range can widen, the labels have to follow it or they
// describe a track that isn't there. Step up so a widened range doesn't
// crowd the axis with labels.
function axisTicks(lo: number, hi: number): number[] {
  const step = Math.max(1, Math.ceil((hi - lo) / 6));
  const out: number[] = [];
  for (let v = lo; v <= hi; v += step) out.push(v);
  return out;
}

function PeerComparison({
  slug,
  counties,
  currentFips,
}: {
  slug: string;
  counties: CountyEntry[];
  currentFips: string;
}) {
  const current = counties.find((c) => c.fips === currentFips);
  const eligible = useMemo(
    () =>
      counties.filter(
        (c) => c.fips !== currentFips && c.term_30.n_loans >= 30 && c.term_30.simple_mean_pct,
      ),
    [counties, currentFips],
  );
  if (!current?.term_30.simple_mean_pct || eligible.length === 0) return null;
  const target = current.term_30.simple_mean_pct;
  const sorted = [...eligible].sort(
    (a, b) =>
      Math.abs((a.term_30.simple_mean_pct ?? 0) - target) -
      Math.abs((b.term_30.simple_mean_pct ?? 0) - target),
  );
  const peers = sorted.slice(0, 6);
  return (
    <section className="section">
      <h3>Counties closest to {current.name} (30-yr mean)</h3>
      <div className="kv-grid">
        {peers.map((p) => (
          <Link key={p.fips} to={`/state/${slug}/county/${p.fips}`} className="kv kv-link">
            <span className="k">{p.name}</span>
            <span className="v">{fmtRate(p.term_30.simple_mean_pct)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

function compareBp(a?: number, b?: number): string {
  if (a == null || b == null) return "—";
  // bp here is the integer count of basis points; we format it as a
  // friendly "X.XX percentage points" string for body copy.
  const bp = Math.round((a - b) * 100);
  if (bp === 0) return "identical";
  const pts = (Math.abs(bp) / 100).toFixed(2);
  return bp > 0 ? `${pts} percentage points higher` : `${pts} percentage points lower`;
}

function countyAggregateBlurb(c: CountyEntry): string {
  const n30 = c.term_30.n_loans;
  const n15 = c.term_15.n_loans;
  return `${n30.toLocaleString()} closed 30-year loans + ${n15.toLocaleString()} 15-year, 2024.`;
}

function notFound(slug: string, fips?: string, stateName?: string) {
  return (
    <div>
      {stateName && (
        <Link to={`/state/${slug}`} className="county-back-link">
          <span aria-hidden="true">←</span> Back to {stateName} dashboard
        </Link>
      )}
      <h1 className="county-page-h1">County not found</h1>
      <p>{fips ? `FIPS ${fips} not in this state's HMDA data.` : "Unknown state."}</p>
    </div>
  );
}
