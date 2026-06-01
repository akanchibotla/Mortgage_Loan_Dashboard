import { Suspense, use, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadStateData, loadStatesIndex, type StateData } from "../lib/loadStateData";
import type { CountyEntry, HmdaSummary } from "../types";

const cache = new Map<string, Promise<StateData | null>>();
function getStatePromise(slug: string): Promise<StateData | null> {
  let p = cache.get(slug);
  if (!p) {
    p = loadStateData(slug);
    cache.set(slug, p);
  }
  return p;
}

function monthlyPayment(principal: number, annualRatePct: number, termYears: number): number {
  const r = annualRatePct / 100 / 12;
  const n = termYears * 12;
  if (r <= 0) return principal / n;
  return (principal * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);
}

function latestNonNull(rows: { rate: number | null }[] | null | undefined): number | null {
  if (!rows) return null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].rate != null) return rows[i].rate as number;
  }
  return null;
}

export default function CalculatorPage() {
  const { states } = loadStatesIndex();
  const ordered = useMemo(
    () =>
      [...states].sort(
        (a, b) =>
          Number(b.has_hmda_band) - Number(a.has_hmda_band) || a.name.localeCompare(b.name),
      ),
    [states],
  );
  const defaultSlug =
    ordered.find((s) => s.has_hmda_band)?.slug ?? ordered[0]?.slug ?? "north-carolina";
  const [slug, setSlug] = useState(defaultSlug);
  const [countyFips, setCountyFips] = useState<string>("");
  const [term, setTerm] = useState<15 | 30>(30);
  const [loanAmount, setLoanAmount] = useState(350_000);

  return (
    <>
      <p className="breadcrumb">
        <Link to="/">&larr; Home</Link>
      </p>
      <h1>Borrower expectation calculator</h1>
      <p className="sub">
        Pick a state, county (when available), loan term, and loan amount. The calculator anchors
        your <i>expected rate range</i> in the HMDA 2024 actual closed-loan distribution for that
        area, then estimates monthly P&amp;I at the p10 / median / p90 of that distribution.
      </p>

      <section className="section calc-form">
        <label>
          <span>State</span>
          <select
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setCountyFips("");
            }}
          >
            {ordered.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name} {s.has_hmda_band ? "(HMDA)" : ""}
              </option>
            ))}
          </select>
        </label>
        <Suspense fallback={<label><span>County</span><select disabled><option>loading…</option></select></label>}>
          <CountyPicker slug={slug} countyFips={countyFips} onChange={setCountyFips} />
        </Suspense>
        <label>
          <span>Loan term</span>
          <div className="term-toggle">
            <button type="button" className={term === 15 ? "active" : ""} onClick={() => setTerm(15)}>
              15-year
            </button>
            <button type="button" className={term === 30 ? "active" : ""} onClick={() => setTerm(30)}>
              30-year
            </button>
          </div>
        </label>
        <label>
          <span>Loan amount</span>
          <input
            type="number"
            min={50_000}
            max={3_000_000}
            step={5_000}
            value={loanAmount}
            onChange={(e) => setLoanAmount(Math.max(0, Number(e.target.value)))}
          />
          <input
            type="range"
            min={50_000}
            max={1_500_000}
            step={5_000}
            value={loanAmount}
            onChange={(e) => setLoanAmount(Number(e.target.value))}
            className="amount-slider"
          />
        </label>
      </section>

      <Suspense fallback={<p className="loading">Loading {slug}…</p>}>
        <CalculatorOutput slug={slug} countyFips={countyFips} term={term} loanAmount={loanAmount} />
      </Suspense>
    </>
  );
}

function CountyPicker({
  slug,
  countyFips,
  onChange,
}: {
  slug: string;
  countyFips: string;
  onChange: (fips: string) => void;
}) {
  const data = use(getStatePromise(slug));
  const counties = data?.counties?.counties ?? [];
  if (counties.length === 0) {
    return (
      <label>
        <span>County</span>
        <select disabled>
          <option>not bundled for this state</option>
        </select>
      </label>
    );
  }
  const ordered = [...counties].sort((a, b) => b.term_30.n_loans - a.term_30.n_loans);
  return (
    <label>
      <span>County (optional)</span>
      <select value={countyFips} onChange={(e) => onChange(e.target.value)}>
        <option value="">— all of {data?.meta?.name ?? slug} —</option>
        {ordered.map((c) => (
          <option key={c.fips} value={c.fips}>
            {c.name} (n={c.term_30.n_loans.toLocaleString()})
          </option>
        ))}
      </select>
    </label>
  );
}

function CalculatorOutput({
  slug,
  countyFips,
  term,
  loanAmount,
}: {
  slug: string;
  countyFips: string;
  term: 15 | 30;
  loanAmount: number;
}) {
  const data = use(getStatePromise(slug));
  if (!data) {
    return <p className="loading">No data bundled for {slug} yet.</p>;
  }
  const county: CountyEntry | undefined = countyFips
    ? data.counties?.counties.find((c) => c.fips === countyFips)
    : undefined;
  const bankrate = term === 15 ? data.bankrate15 : data.bankrate30;
  const mnd = term === 15 ? data.mnd15 : data.mnd30;
  const liveBankrate = latestNonNull(bankrate);
  const liveMnd = latestNonNull(mnd);
  const stateHmda: HmdaSummary | undefined = term === 15 ? data.hmda15 : data.hmda30;
  const countyDist = county ? (term === 15 ? county.term_15 : county.term_30) : undefined;

  // Pick the distribution to anchor on: county if user picked one and it has data,
  // otherwise the state-level HMDA.
  const distLabel = countyDist?.n_loans
    ? `${county!.name} County (n=${countyDist.n_loans.toLocaleString()})`
    : stateHmda?.n_loans
      ? `${data.meta.name} (n=${stateHmda.n_loans.toLocaleString()})`
      : null;

  const p10 = countyDist?.p10_pct ?? stateHmda?.p10_pct;
  const p25 = countyDist?.p25_pct ?? stateHmda?.p25_pct;
  const p50 = countyDist?.p50_pct ?? stateHmda?.p50_pct;
  const p75 = countyDist?.p75_pct ?? stateHmda?.p75_pct;
  const p90 = countyDist?.p90_pct ?? stateHmda?.p90_pct;
  const meanRate =
    countyDist?.simple_mean_pct ?? stateHmda?.simple_mean_pct ?? liveBankrate ?? liveMnd ?? null;

  return (
    <>
      <section className="section">
        <h2>Today's market — {data.meta.name}</h2>
        <div className="kv-grid">
          <Stat
            k={`Bankrate (${term}-yr, today)`}
            v={liveBankrate != null ? `${liveBankrate.toFixed(2)}%` : "—"}
          />
          <Stat
            k={`Mortgage News Daily (${term}-yr, today)`}
            v={liveMnd != null ? `${liveMnd.toFixed(2)}%` : "—"}
          />
        </div>
      </section>

      {distLabel ? (
        <section className="section">
          <h2>
            What borrowers actually paid in 2024 — {distLabel} {term}-yr
          </h2>
          {p10 != null && p90 != null && (
            <DistributionBar
              p10={p10}
              p25={p25}
              p50={p50}
              p75={p75}
              p90={p90}
              market={liveBankrate ?? liveMnd ?? undefined}
            />
          )}
          <div className="kv-grid">
            {p10 != null && <Stat k="p10 (low)" v={`${p10.toFixed(2)}%`} />}
            {p25 != null && <Stat k="p25" v={`${p25.toFixed(2)}%`} />}
            {p50 != null && <Stat k="median" v={`${p50.toFixed(2)}%`} />}
            {p75 != null && <Stat k="p75" v={`${p75.toFixed(2)}%`} />}
            {p90 != null && <Stat k="p90 (high)" v={`${p90.toFixed(2)}%`} />}
          </div>
        </section>
      ) : (
        <section className="section">
          <p className="loading">
            HMDA distribution not bundled for {data.meta.name}{" "}
            {term}-yr yet. Payment estimates below use today's Bankrate rate as the central anchor.
          </p>
        </section>
      )}

      <section className="section">
        <h2>
          Estimated monthly P&amp;I — ${loanAmount.toLocaleString()} / {term} yr
        </h2>
        <div className="kv-grid">
          {meanRate != null && (
            <Stat
              k={`@ ${meanRate.toFixed(2)}% (central)`}
              v={`$${monthlyPayment(loanAmount, meanRate, term).toFixed(0)}`}
            />
          )}
          {p10 != null && (
            <Stat
              k={`@ ${p10.toFixed(2)}% (best 10%)`}
              v={`$${monthlyPayment(loanAmount, p10, term).toFixed(0)}`}
            />
          )}
          {p90 != null && (
            <Stat
              k={`@ ${p90.toFixed(2)}% (worst 10%)`}
              v={`$${monthlyPayment(loanAmount, p90, term).toFixed(0)}`}
            />
          )}
        </div>
        <p className="sub">
          Principal &amp; interest only. Excludes taxes, insurance, PMI, HOA. Lender quotes vary by
          credit profile, LTV, and program.
        </p>
      </section>

      <div className="notes">
        <p>
          <Link to={`/state/${slug}`}>See full {data.meta.name} dashboard &rarr;</Link>
          {countyFips && (
            <>
              {" · "}
              <Link to={`/state/${slug}/county/${countyFips}`}>
                See {county?.name ?? "county"} County dashboard &rarr;
              </Link>
            </>
          )}
        </p>
      </div>
    </>
  );
}

function DistributionBar({
  p10,
  p25,
  p50,
  p75,
  p90,
  market,
}: {
  p10: number;
  p25?: number;
  p50?: number;
  p75?: number;
  p90: number;
  market?: number;
}) {
  const RANGE_LO = 4;
  const RANGE_HI = 10;
  const span = RANGE_HI - RANGE_LO;
  const pct = (v: number) => `${((v - RANGE_LO) / span) * 100}%`;
  const w = (a: number, b: number) => `${((b - a) / span) * 100}%`;
  return (
    <div className="dist-bar">
      <div className="dist-axis">
        {[4, 5, 6, 7, 8, 9, 10].map((v) => (
          <span key={v} style={{ left: pct(v) }}>
            {v}%
          </span>
        ))}
      </div>
      <div className="dist-track">
        <div
          className="dist-band-outer"
          style={{ left: pct(p10), width: w(p10, p90) }}
          title={`p10–p90: ${p10.toFixed(2)}%–${p90.toFixed(2)}%`}
        />
        {p25 != null && p75 != null && (
          <div
            className="dist-band-inner"
            style={{ left: pct(p25), width: w(p25, p75) }}
            title={`p25–p75: ${p25.toFixed(2)}%–${p75.toFixed(2)}%`}
          />
        )}
        {p50 != null && (
          <div
            className="dist-median"
            style={{ left: pct(p50) }}
            title={`median: ${p50.toFixed(2)}%`}
          />
        )}
        {market != null && market >= RANGE_LO && market <= RANGE_HI && (
          <div
            className="dist-market"
            style={{ left: pct(market) }}
            title={`Today's market: ${market.toFixed(2)}%`}
          />
        )}
      </div>
      <p className="sub" style={{ marginTop: 8 }}>
        Light green band: middle 80% of borrowers. Dark green: middle 50%. Black line: median.{" "}
        {market != null && "Blue line: today's market quote."}
      </p>
    </div>
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
