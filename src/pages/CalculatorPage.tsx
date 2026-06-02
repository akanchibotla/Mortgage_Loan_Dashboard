import { Suspense, use, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadPmms, loadStateData, loadStatesIndex, type StateData } from "../lib/loadStateData";
import { usePageMeta } from "../lib/usePageMeta";
import type { CountyEntry, HmdaSummary } from "../types";

const MAX_LOANS = 4;

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

interface LoanInstance {
  id: string;
  slug: string;
  countyFips: string;
  term: 15 | 30;
  loanAmount: number;
  rateText: string;
}

function newLoanId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `loan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type StatesIndex = ReturnType<typeof loadStatesIndex>["states"];

function parseCustomRate(rateText: string): number | null {
  const t = rateText.trim();
  if (t === "") return null;
  const v = Number.parseFloat(t);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export default function CalculatorPage() {
  usePageMeta({
    title: "Borrower expectation calculator",
    description:
      "Compare up to four loan scenarios side by side. Each anchors your expected rate range in the HMDA 2024 actual closed-loan distribution for the state and county you pick, with monthly P&I estimates at p10 / median / p90.",
  });
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

  const [loans, setLoans] = useState<LoanInstance[]>(() => [
    {
      id: newLoanId(),
      slug: defaultSlug,
      countyFips: "",
      term: 30,
      loanAmount: 350_000,
      rateText: "",
    },
  ]);

  function updateLoan(id: string, patch: Partial<LoanInstance>) {
    setLoans((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function addLoan() {
    setLoans((prev) => {
      if (prev.length >= MAX_LOANS) return prev;
      const last = prev[prev.length - 1];
      return [...prev, { ...last, id: newLoanId() }];
    });
  }

  function removeLoan(id: string) {
    setLoans((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));
  }

  const cols = Math.min(loans.length, MAX_LOANS);

  return (
    <>
      <p className="breadcrumb">
        <Link to="/">&larr; Home</Link>
      </p>
      <h1>Borrower expectation calculator</h1>
      <p className="sub">
        Compare up to {MAX_LOANS} loan scenarios side by side. Each one anchors your{" "}
        <i>expected rate range</i> in the HMDA 2024 actual closed-loan distribution for the
        state and county you pick.
      </p>

      <div className="calc-compare-header">
        <div className="calc-compare-title-row">
          <h2 className="calc-compare-title">Compare loans</h2>
          <span className="calc-compare-count">
            {loans.length} of {MAX_LOANS}
          </span>
        </div>
        <button
          type="button"
          className="btn-add-loan"
          onClick={addLoan}
          disabled={loans.length >= MAX_LOANS}
          title={
            loans.length >= MAX_LOANS
              ? `Maximum ${MAX_LOANS} loans for comparison`
              : "Add another loan to compare side by side"
          }
        >
          <span className="btn-add-icon" aria-hidden="true">
            +
          </span>
          <span>Add comparison loan</span>
        </button>
      </div>

      <div className={`calc-compare-grid cols-${cols}`}>
        {loans.map((loan, idx) => (
          <LoanCard
            key={loan.id}
            loan={loan}
            index={idx}
            states={ordered}
            canRemove={loans.length > 1}
            onChange={(patch) => updateLoan(loan.id, patch)}
            onRemove={() => removeLoan(loan.id)}
          />
        ))}
      </div>
    </>
  );
}

function LoanCard({
  loan,
  index,
  states,
  canRemove,
  onChange,
  onRemove,
}: {
  loan: LoanInstance;
  index: number;
  states: StatesIndex;
  canRemove: boolean;
  onChange: (patch: Partial<LoanInstance>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="loan-card">
      <div className="loan-card-header">
        <h3 className="loan-card-title">Loan {index + 1}</h3>
        {canRemove && (
          <button
            type="button"
            className="loan-card-remove"
            onClick={onRemove}
            aria-label={`Remove loan ${index + 1}`}
            title="Remove this loan"
          >
            ✕
          </button>
        )}
      </div>

      {loan.slug ? (
        <Suspense fallback={<p className="loading">Loading {loan.slug}…</p>}>
          <StateLoanContent loan={loan} states={states} onChange={onChange} />
        </Suspense>
      ) : (
        <NationalLoanContent loan={loan} states={states} onChange={onChange} />
      )}
    </div>
  );
}

function StateLoanContent({
  loan,
  states,
  onChange,
}: {
  loan: LoanInstance;
  states: StatesIndex;
  onChange: (patch: Partial<LoanInstance>) => void;
}) {
  const data = use(getStatePromise(loan.slug));
  if (!data) {
    return (
      <>
        <LoanCardForm
          loan={loan}
          states={states}
          counties={[]}
          stateName=""
          anchorRate={null}
          anchorLabel="central"
          onChange={onChange}
        />
        <p className="loading">No data bundled for {loan.slug} yet.</p>
      </>
    );
  }

  const county: CountyEntry | undefined = loan.countyFips
    ? data.counties?.counties.find((c) => c.fips === loan.countyFips)
    : undefined;
  const bankrate = loan.term === 15 ? data.bankrate15 : data.bankrate30;
  const mnd = loan.term === 15 ? data.mnd15 : data.mnd30;
  const liveBankrate = latestNonNull(bankrate);
  const liveMnd = latestNonNull(mnd);
  const stateHmda: HmdaSummary | undefined = loan.term === 15 ? data.hmda15 : data.hmda30;
  const countyDist = county ? (loan.term === 15 ? county.term_15 : county.term_30) : undefined;

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
  const anchorRate =
    countyDist?.simple_mean_pct ?? stateHmda?.simple_mean_pct ?? liveBankrate ?? liveMnd ?? null;

  const customRate = parseCustomRate(loan.rateText);
  const centralRate = customRate ?? anchorRate;
  const centralLabel = customRate != null ? "your rate" : "central";

  return (
    <>
      <LoanCardForm
        loan={loan}
        states={states}
        counties={data.counties?.counties ?? []}
        stateName={data.meta.name}
        anchorRate={anchorRate}
        anchorLabel="central"
        onChange={onChange}
      />

      <div className="loan-block">
        <h4 className="loan-block-h">Today's market</h4>
        <ul className="loan-stats">
          <li>
            <span className="k">Bankrate ({loan.term}-yr)</span>
            <span className="v">{liveBankrate != null ? `${liveBankrate.toFixed(2)}%` : "—"}</span>
          </li>
          <li>
            <span className="k">MND ({loan.term}-yr)</span>
            <span className="v">{liveMnd != null ? `${liveMnd.toFixed(2)}%` : "—"}</span>
          </li>
        </ul>
      </div>

      {distLabel ? (
        <div className="loan-block">
          <h4 className="loan-block-h">
            2024 HMDA — <span className="loan-block-h-sub">{distLabel}</span>
          </h4>
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
          <ul className="loan-stats">
            {p10 != null && (
              <li>
                <span className="k">p10 (low)</span>
                <span className="v">{p10.toFixed(2)}%</span>
              </li>
            )}
            {p50 != null && (
              <li>
                <span className="k">median</span>
                <span className="v">{p50.toFixed(2)}%</span>
              </li>
            )}
            {p90 != null && (
              <li>
                <span className="k">p90 (high)</span>
                <span className="v">{p90.toFixed(2)}%</span>
              </li>
            )}
          </ul>
        </div>
      ) : (
        <div className="loan-block">
          <p className="loan-block-empty">
            HMDA distribution not bundled for {data.meta.name} {loan.term}-yr yet.
          </p>
        </div>
      )}

      <div className="loan-block loan-block-output">
        <h4 className="loan-block-h">
          Monthly P&amp;I — ${loan.loanAmount.toLocaleString()}
        </h4>
        <ul className="loan-stats loan-stats-output">
          {centralRate != null && (
            <li>
              <span className="k">
                @ {centralRate.toFixed(2)}% ({centralLabel})
              </span>
              <span className="v">
                ${Math.round(monthlyPayment(loan.loanAmount, centralRate, loan.term)).toLocaleString()}
              </span>
            </li>
          )}
          {p10 != null && (
            <li>
              <span className="k">@ {p10.toFixed(2)}% (best 10%)</span>
              <span className="v">
                ${Math.round(monthlyPayment(loan.loanAmount, p10, loan.term)).toLocaleString()}
              </span>
            </li>
          )}
          {p90 != null && (
            <li>
              <span className="k">@ {p90.toFixed(2)}% (worst 10%)</span>
              <span className="v">
                ${Math.round(monthlyPayment(loan.loanAmount, p90, loan.term)).toLocaleString()}
              </span>
            </li>
          )}
        </ul>
      </div>

      <div className="loan-card-footer">
        <Link to={`/state/${loan.slug}`}>{data.meta.name} dashboard &rarr;</Link>
        {loan.countyFips && (
          <>
            {" · "}
            <Link to={`/state/${loan.slug}/county/${loan.countyFips}`}>
              {county?.name ?? "county"} County &rarr;
            </Link>
          </>
        )}
      </div>
    </>
  );
}

function NationalLoanContent({
  loan,
  states,
  onChange,
}: {
  loan: LoanInstance;
  states: StatesIndex;
  onChange: (patch: Partial<LoanInstance>) => void;
}) {
  const { pmms15, pmms30 } = loadPmms();
  const usRate = loan.term === 15 ? latestNonNull(pmms15) : latestNonNull(pmms30);

  const customRate = parseCustomRate(loan.rateText);
  const centralRate = customRate ?? usRate;
  const centralLabel = customRate != null ? "your rate" : "U.S. PMMS";

  return (
    <>
      <LoanCardForm
        loan={loan}
        states={states}
        counties={[]}
        stateName=""
        anchorRate={usRate}
        anchorLabel="U.S. PMMS"
        onChange={onChange}
      />

      <div className="loan-block">
        <h4 className="loan-block-h">Today's market — U.S.</h4>
        <ul className="loan-stats">
          <li>
            <span className="k">FRED PMMS ({loan.term}-yr, latest)</span>
            <span className="v">{usRate != null ? `${usRate.toFixed(2)}%` : "—"}</span>
          </li>
        </ul>
      </div>

      <div className="loan-block">
        <p className="loan-block-empty">
          HMDA distribution requires a state selection — pick one above to see the actual
          2024 closed-loan range.
        </p>
      </div>

      <div className="loan-block loan-block-output">
        <h4 className="loan-block-h">
          Monthly P&amp;I — ${loan.loanAmount.toLocaleString()}
        </h4>
        <ul className="loan-stats loan-stats-output">
          {centralRate != null && (
            <li>
              <span className="k">
                @ {centralRate.toFixed(2)}% ({centralLabel})
              </span>
              <span className="v">
                ${Math.round(monthlyPayment(loan.loanAmount, centralRate, loan.term)).toLocaleString()}
              </span>
            </li>
          )}
        </ul>
      </div>

      <div className="loan-card-footer">
        <Link to="/methodology">FRED PMMS methodology &rarr;</Link>
      </div>
    </>
  );
}

function LoanCardForm({
  loan,
  states,
  counties,
  stateName,
  anchorRate,
  anchorLabel,
  onChange,
}: {
  loan: LoanInstance;
  states: StatesIndex;
  counties: CountyEntry[];
  stateName: string;
  anchorRate: number | null;
  anchorLabel: string;
  onChange: (patch: Partial<LoanInstance>) => void;
}) {
  const customRate = parseCustomRate(loan.rateText);
  const useCustom = customRate != null;
  const rateDisplay = useCustom
    ? loan.rateText
    : anchorRate != null
      ? anchorRate.toFixed(2)
      : "";

  const countySorted = useMemo(
    () => [...counties].sort((a, b) => b.term_30.n_loans - a.term_30.n_loans),
    [counties],
  );

  return (
    <div className="loan-card-form">
      <label>
        <span>State (optional)</span>
        <select
          value={loan.slug}
          onChange={(e) => onChange({ slug: e.target.value, countyFips: "" })}
        >
          <option value="">— National (all U.S.) —</option>
          {states.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name} {s.has_hmda_band ? "(HMDA)" : ""}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>{loan.slug && counties.length > 0 ? "County (optional)" : "County"}</span>
        {loan.slug ? (
          counties.length === 0 ? (
            <select disabled>
              <option>not bundled</option>
            </select>
          ) : (
            <select
              value={loan.countyFips}
              onChange={(e) => onChange({ countyFips: e.target.value })}
            >
              <option value="">— all of {stateName} —</option>
              {countySorted.map((c) => (
                <option key={c.fips} value={c.fips}>
                  {c.name} (n={c.term_30.n_loans.toLocaleString()})
                </option>
              ))}
            </select>
          )
        ) : (
          <select disabled>
            <option>— pick a state first —</option>
          </select>
        )}
      </label>

      <label>
        <span>Loan term</span>
        <div className="term-toggle">
          <button
            type="button"
            className={loan.term === 15 ? "active" : ""}
            onClick={() => onChange({ term: 15 })}
          >
            15-year
          </button>
          <button
            type="button"
            className={loan.term === 30 ? "active" : ""}
            onClick={() => onChange({ term: 30 })}
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
          value={loan.loanAmount}
          onChange={(e) => onChange({ loanAmount: Math.max(0, Number(e.target.value)) })}
        />
      </label>

      <label>
        <span>
          Rate{" "}
          <span className="loan-form-field-meta">
            ({useCustom ? "your value" : anchorLabel})
          </span>
        </span>
        <div className="rate-field-wrap">
          <input
            type="number"
            min={0}
            max={30}
            step={0.05}
            value={rateDisplay}
            onChange={(e) => onChange({ rateText: e.target.value })}
          />
          {useCustom && (
            <button
              type="button"
              className="rate-reset-btn"
              onClick={() => onChange({ rateText: "" })}
              title={`Reset to ${anchorLabel}${anchorRate != null ? ` (${anchorRate.toFixed(2)}%)` : ""}`}
              aria-label="Reset rate to default"
            >
              ↺
            </button>
          )}
        </div>
      </label>
    </div>
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
        />
        {p25 != null && p75 != null && (
          <div
            className="dist-band-inner"
            style={{ left: pct(p25), width: w(p25, p75) }}
          />
        )}
        {p50 != null && <div className="dist-median" style={{ left: pct(p50) }} />}
        {market != null && market >= RANGE_LO && market <= RANGE_HI && (
          <div className="dist-market" style={{ left: pct(market) }} />
        )}
      </div>
    </div>
  );
}
