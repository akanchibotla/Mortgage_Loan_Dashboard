import { Suspense, use, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadStateData, loadStatesIndex, type StateData } from "../lib/loadStateData";

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
  // Order: HMDA-supported states first, then others.
  const ordered = useMemo(
    () =>
      [...states].sort(
        (a, b) =>
          Number(b.has_hmda_band) - Number(a.has_hmda_band) ||
          a.name.localeCompare(b.name),
      ),
    [states],
  );
  const defaultSlug =
    ordered.find((s) => s.has_hmda_band)?.slug ?? ordered[0]?.slug ?? "north-carolina";
  const [slug, setSlug] = useState(defaultSlug);
  const [term, setTerm] = useState<15 | 30>(30);
  const [loanAmount, setLoanAmount] = useState(350_000);

  return (
    <>
      <p className="breadcrumb">
        <Link to="/">&larr; Home</Link>
      </p>
      <h1>Borrower expectation calculator</h1>
      <p className="sub">
        Inputs are <i>indicative</i>. Estimated rate range is anchored to the HMDA 2024 actual closed-loan
        distribution where available (currently only NC). When HMDA isn't available for a state, we show
        today's Bankrate and Mortgage News Daily rates and skip the band.
      </p>

      <section className="section calc-form">
        <label>
          <span>State</span>
          <select value={slug} onChange={(e) => setSlug(e.target.value)}>
            {ordered.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name} {s.has_hmda_band ? "(HMDA)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Loan term</span>
          <div className="term-toggle">
            <button
              type="button"
              className={term === 15 ? "active" : ""}
              onClick={() => setTerm(15)}
            >
              15-year
            </button>
            <button
              type="button"
              className={term === 30 ? "active" : ""}
              onClick={() => setTerm(30)}
            >
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
        <CalculatorOutput slug={slug} term={term} loanAmount={loanAmount} />
      </Suspense>
    </>
  );
}

function CalculatorOutput({
  slug,
  term,
  loanAmount,
}: {
  slug: string;
  term: 15 | 30;
  loanAmount: number;
}) {
  const data = use(getStatePromise(slug));
  if (!data) {
    return (
      <p className="loading">
        No data bundled for {slug} yet. Pick another state or come back when this one is backfilled.
      </p>
    );
  }
  const bankrate = term === 15 ? data.bankrate15 : data.bankrate30;
  const mnd = term === 15 ? data.mnd15 : data.mnd30;
  const liveBankrate = latestNonNull(bankrate);
  const liveMnd = latestNonNull(mnd);
  const hmda = term === 15 ? data.hmda15 : undefined;

  const medianRate = hmda?.simple_mean_pct ?? liveBankrate ?? liveMnd ?? null;
  const p10 = hmda?.p10_pct ?? null;
  const p90 = hmda?.p90_pct ?? null;

  return (
    <>
      <section className="section">
        <h2>Today's market — {data.meta.name}</h2>
        <div className="kv-grid">
          <div className="kv">
            <span className="k">Bankrate ({term}-yr fixed)</span>
            <span className="v">{liveBankrate != null ? `${liveBankrate.toFixed(2)}%` : "—"}</span>
          </div>
          <div className="kv">
            <span className="k">Mortgage News Daily ({term}-yr fixed)</span>
            <span className="v">{liveMnd != null ? `${liveMnd.toFixed(2)}%` : "—"}</span>
          </div>
        </div>
      </section>

      {hmda ? (
        <section className="section">
          <h2>
            HMDA 2024 {data.meta.postal} 15-yr distribution (n={hmda.n_loans.toLocaleString()})
          </h2>
          <p className="sub">
            Term {term}=15 only (HMDA 30-yr band not yet bundled). What NC borrowers actually closed in 2024.
          </p>
          <div className="kv-grid">
            <Stat k="p10" v={`${hmda.p10_pct.toFixed(2)}%`} />
            <Stat k="p25" v={`${hmda.p25_pct.toFixed(2)}%`} />
            <Stat k="median (p50)" v={`${hmda.p50_pct.toFixed(2)}%`} />
            <Stat k="p75" v={`${hmda.p75_pct.toFixed(2)}%`} />
            <Stat k="p90" v={`${hmda.p90_pct.toFixed(2)}%`} />
            <Stat k="simple mean" v={`${hmda.simple_mean_pct.toFixed(2)}%`} />
            <Stat k="loan-amount-weighted mean" v={`${hmda.amount_weighted_mean_pct.toFixed(2)}%`} />
          </div>
        </section>
      ) : (
        <section className="section">
          <p className="loading">
            HMDA band not bundled for {data.meta.name} yet (needs FFIEC national LAR partition). The
            payment estimates below use the Bankrate latest as the central rate.
          </p>
        </section>
      )}

      <section className="section">
        <h2>Estimated monthly P&amp;I — ${loanAmount.toLocaleString()} over {term} years</h2>
        <div className="kv-grid">
          {medianRate != null && (
            <Stat
              k={`@ ${medianRate.toFixed(2)}% (central)`}
              v={`$${monthlyPayment(loanAmount, medianRate, term).toFixed(0).toLocaleString()}`}
            />
          )}
          {p10 != null && (
            <Stat
              k={`@ ${p10.toFixed(2)}% (HMDA p10, "best case")`}
              v={`$${monthlyPayment(loanAmount, p10, term).toFixed(0).toLocaleString()}`}
            />
          )}
          {p90 != null && (
            <Stat
              k={`@ ${p90.toFixed(2)}% (HMDA p90, "worst case")`}
              v={`$${monthlyPayment(loanAmount, p90, term).toFixed(0).toLocaleString()}`}
            />
          )}
        </div>
        <p className="sub">
          Principal &amp; interest only. Excludes taxes, insurance, PMI, HOA. Lender quotes will vary
          by credit profile, LTV, and program.
        </p>
      </section>

      <div className="notes">
        <p>
          <Link to={`/state/${slug}`}>See full {data.meta.name} dashboard &rarr;</Link>
        </p>
      </div>
    </>
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
