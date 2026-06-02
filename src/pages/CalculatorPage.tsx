import { lazy, Suspense, use, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadPmms, loadStateData, loadStatesIndex, type StateData } from "../lib/loadStateData";
import { usePageMeta } from "../lib/usePageMeta";
import type { CountyEntry, HmdaSummary } from "../types";

const AmortPanel = lazy(() =>
  import("../components/AmortPanel").then((m) => ({ default: m.AmortPanel })),
);

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

type ProductType =
  | "fixed"
  | "arm-7-1"
  | "arm-5-1"
  | "buydown-2-1"
  | "buydown-1-0"
  | "buydown-3-2-1";

interface LoanInstance {
  id: string;
  slug: string;
  countyFips: string;
  term: 15 | 30;
  productType: ProductType;
  loanAmount: number;
  rateText: string;
  hasCustomRate: boolean;
  armAdjustedRateText: string;
  hasCustomArmAdjustedRate: boolean;
}

interface RatePhase {
  months: number;
  rate: number;
  label: string;
}

function buildPhases(
  productType: ProductType,
  noteRate: number,
  armAdjustedRate: number,
  totalMonths: number,
): RatePhase[] {
  const clamp = (r: number) => Math.max(0, r);
  switch (productType) {
    case "fixed":
      return [{ months: totalMonths, rate: noteRate, label: "Fixed" }];
    case "arm-7-1": {
      const initialMonths = Math.min(84, totalMonths);
      const remainder = Math.max(0, totalMonths - initialMonths);
      return [
        { months: initialMonths, rate: noteRate, label: "Years 1–7" },
        ...(remainder > 0
          ? [{ months: remainder, rate: armAdjustedRate, label: "Years 8+" }]
          : []),
      ];
    }
    case "arm-5-1": {
      const initialMonths = Math.min(60, totalMonths);
      const remainder = Math.max(0, totalMonths - initialMonths);
      return [
        { months: initialMonths, rate: noteRate, label: "Years 1–5" },
        ...(remainder > 0
          ? [{ months: remainder, rate: armAdjustedRate, label: "Years 6+" }]
          : []),
      ];
    }
    case "buydown-2-1": {
      const tail = Math.max(0, totalMonths - 24);
      return [
        { months: Math.min(12, totalMonths), rate: clamp(noteRate - 2), label: "Year 1" },
        {
          months: Math.min(12, Math.max(0, totalMonths - 12)),
          rate: clamp(noteRate - 1),
          label: "Year 2",
        },
        ...(tail > 0 ? [{ months: tail, rate: noteRate, label: "Year 3+" }] : []),
      ];
    }
    case "buydown-1-0": {
      const tail = Math.max(0, totalMonths - 12);
      return [
        { months: Math.min(12, totalMonths), rate: clamp(noteRate - 1), label: "Year 1" },
        ...(tail > 0 ? [{ months: tail, rate: noteRate, label: "Year 2+" }] : []),
      ];
    }
    case "buydown-3-2-1": {
      const tail = Math.max(0, totalMonths - 36);
      return [
        { months: Math.min(12, totalMonths), rate: clamp(noteRate - 3), label: "Year 1" },
        {
          months: Math.min(12, Math.max(0, totalMonths - 12)),
          rate: clamp(noteRate - 2),
          label: "Year 2",
        },
        {
          months: Math.min(12, Math.max(0, totalMonths - 24)),
          rate: clamp(noteRate - 1),
          label: "Year 3",
        },
        ...(tail > 0 ? [{ months: tail, rate: noteRate, label: "Year 4+" }] : []),
      ];
    }
  }
}

interface ScheduleRow {
  month: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

function computeProductSchedule(
  loanAmount: number,
  productType: ProductType,
  noteRate: number,
  armAdjustedRate: number,
  termYears: number,
): ScheduleRow[] {
  if (!Number.isFinite(loanAmount) || loanAmount <= 0) return [];
  const totalMonths = Math.round(termYears * 12);
  if (totalMonths <= 0) return [];
  const phases = buildPhases(productType, noteRate, armAdjustedRate, totalMonths);
  const rows: ScheduleRow[] = [];
  let balance = loanAmount;
  let monthsRemaining = totalMonths;
  for (const phase of phases) {
    if (phase.months <= 0) continue;
    const phaseRate = phase.rate / 100 / 12;
    const phasePayment =
      phaseRate > 0
        ? (balance * (phaseRate * Math.pow(1 + phaseRate, monthsRemaining))) /
          (Math.pow(1 + phaseRate, monthsRemaining) - 1)
        : balance / monthsRemaining;
    for (let m = 0; m < phase.months; m++) {
      const interest = balance * phaseRate;
      const principal = Math.min(phasePayment - interest, balance);
      balance = Math.max(0, balance - principal);
      rows.push({
        month: rows.length + 1,
        payment: phasePayment,
        interest,
        principal,
        balance,
      });
    }
    monthsRemaining -= phase.months;
  }
  return rows;
}

interface PhasePayment {
  label: string;
  rate: number;
  payment: number;
}

function computePhasePayments(
  loanAmount: number,
  productType: ProductType,
  noteRate: number,
  armAdjustedRate: number,
  termYears: number,
): PhasePayment[] {
  const totalMonths = Math.round(termYears * 12);
  if (!Number.isFinite(loanAmount) || loanAmount <= 0 || totalMonths <= 0) return [];
  const phases = buildPhases(productType, noteRate, armAdjustedRate, totalMonths);
  const out: PhasePayment[] = [];
  let balance = loanAmount;
  let monthsRemaining = totalMonths;
  for (const phase of phases) {
    if (phase.months <= 0) continue;
    const phaseRate = phase.rate / 100 / 12;
    const phasePayment =
      phaseRate > 0
        ? (balance * (phaseRate * Math.pow(1 + phaseRate, monthsRemaining))) /
          (Math.pow(1 + phaseRate, monthsRemaining) - 1)
        : balance / monthsRemaining;
    out.push({ label: phase.label, rate: phase.rate, payment: phasePayment });
    // advance balance by amortizing this phase
    let phaseBalance = balance;
    for (let m = 0; m < phase.months; m++) {
      const interest = phaseBalance * phaseRate;
      const principal = Math.min(phasePayment - interest, phaseBalance);
      phaseBalance = Math.max(0, phaseBalance - principal);
    }
    balance = phaseBalance;
    monthsRemaining -= phase.months;
  }
  return out;
}

interface ProductOption {
  value: ProductType;
  label: string;
  group: "Fixed" | "ARM" | "Buydown";
}

const PRODUCT_OPTIONS: ProductOption[] = [
  { value: "fixed", label: "Fixed-rate", group: "Fixed" },
  { value: "arm-7-1", label: "7/1 ARM", group: "ARM" },
  { value: "arm-5-1", label: "5/1 ARM", group: "ARM" },
  { value: "buydown-2-1", label: "2-1 Buydown", group: "Buydown" },
  { value: "buydown-1-0", label: "1-0 Buydown", group: "Buydown" },
  { value: "buydown-3-2-1", label: "3-2-1 Buydown", group: "Buydown" },
];

const ARM_PRODUCTS = new Set<ProductType>(["arm-7-1", "arm-5-1"]);

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
  return Number.isFinite(v) ? v : null;
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

  const [loans, setLoans] = useState<LoanInstance[]>(() => [
    {
      id: newLoanId(),
      slug: "",
      countyFips: "",
      term: 30,
      productType: "fixed",
      loanAmount: 350_000,
      rateText: "",
      hasCustomRate: false,
      armAdjustedRateText: "",
      hasCustomArmAdjustedRate: false,
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
      <h1>Borrower expectation calculator</h1>

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
          anchorSourceLabel="no rate data available"
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

  let anchorRate: number | null;
  let anchorSourceLabel: string;
  if (countyDist?.simple_mean_pct != null) {
    anchorRate = countyDist.simple_mean_pct;
    anchorSourceLabel = `${county!.name} County HMDA (${loan.term}-yr)`;
  } else if (stateHmda?.simple_mean_pct != null) {
    anchorRate = stateHmda.simple_mean_pct;
    anchorSourceLabel = `${data.meta.name} HMDA (${loan.term}-yr mean)`;
  } else if (liveBankrate != null) {
    anchorRate = liveBankrate;
    anchorSourceLabel = `${data.meta.name} Bankrate (${loan.term}-yr)`;
  } else if (liveMnd != null) {
    anchorRate = liveMnd;
    anchorSourceLabel = `${data.meta.name} MND (${loan.term}-yr)`;
  } else {
    anchorRate = null;
    anchorSourceLabel = "no rate data available";
  }

  const customRate = loan.hasCustomRate ? parseCustomRate(loan.rateText) : null;
  const centralRate = customRate ?? anchorRate;
  const centralLabel = loan.hasCustomRate ? "your rate" : "central";

  return (
    <>
      <LoanCardForm
        loan={loan}
        states={states}
        counties={data.counties?.counties ?? []}
        stateName={data.meta.name}
        anchorRate={anchorRate}
        anchorSourceLabel={anchorSourceLabel}
        onChange={onChange}
      />

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

      <PhasePaymentBlock
        loan={loan}
        centralRate={centralRate}
        centralLabel={centralLabel}
        p10={p10}
        p90={p90}
      />

      <LoanAmortDisclosure
        loan={loan}
        centralRate={centralRate}
      />

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

  const customRate = loan.hasCustomRate ? parseCustomRate(loan.rateText) : null;
  const centralRate = customRate ?? usRate;
  const centralLabel = loan.hasCustomRate ? "your rate" : "U.S. PMMS";

  const anchorSourceLabel = `FRED PMMS (${loan.term}-yr, latest)`;

  return (
    <>
      <LoanCardForm
        loan={loan}
        states={states}
        counties={[]}
        stateName=""
        anchorRate={usRate}
        anchorSourceLabel={anchorSourceLabel}
        onChange={onChange}
      />

      <PhasePaymentBlock
        loan={loan}
        centralRate={centralRate}
        centralLabel={centralLabel}
      />

      <LoanAmortDisclosure
        loan={loan}
        centralRate={centralRate}
      />
    </>
  );
}

function PhasePaymentBlock({
  loan,
  centralRate,
  centralLabel,
  p10,
  p90,
}: {
  loan: LoanInstance;
  centralRate: number | null;
  centralLabel: string;
  p10?: number;
  p90?: number;
}) {
  if (centralRate == null) return null;
  const armRate =
    loan.hasCustomArmAdjustedRate &&
    Number.isFinite(Number.parseFloat(loan.armAdjustedRateText))
      ? Number.parseFloat(loan.armAdjustedRateText)
      : centralRate;
  const phasePayments = computePhasePayments(
    loan.loanAmount,
    loan.productType,
    centralRate,
    armRate,
    loan.term,
  );
  const isFixed = loan.productType === "fixed";
  return (
    <div className="loan-block loan-block-output">
      <h4 className="loan-block-h">
        Monthly P&amp;I — ${loan.loanAmount.toLocaleString()}
      </h4>
      <ul className="loan-stats loan-stats-output">
        {isFixed ? (
          <li>
            <span className="k">
              @ {centralRate.toFixed(2)}% ({centralLabel})
            </span>
            <span className="v">
              ${Math.round(phasePayments[0]?.payment ?? 0).toLocaleString()}
            </span>
          </li>
        ) : (
          phasePayments.map((ph, idx) => (
            <li key={idx}>
              <span className="k">
                {ph.label} @ {ph.rate.toFixed(2)}%
              </span>
              <span className="v">${Math.round(ph.payment).toLocaleString()}</span>
            </li>
          ))
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
  );
}

function LoanAmortDisclosure({
  loan,
  centralRate,
}: {
  loan: LoanInstance;
  centralRate: number | null;
}) {
  const [open, setOpen] = useState(false);
  if (centralRate == null || loan.loanAmount <= 0) return null;
  const armRate =
    loan.hasCustomArmAdjustedRate &&
    Number.isFinite(Number.parseFloat(loan.armAdjustedRateText))
      ? Number.parseFloat(loan.armAdjustedRateText)
      : centralRate;
  const schedule = computeProductSchedule(
    loan.loanAmount,
    loan.productType,
    centralRate,
    armRate,
    loan.term,
  );
  return (
    <details
      className="loan-amort-details"
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>
        <span className="loan-amort-label">See month-by-month amortization</span>
        <span className="loan-amort-meta">{loan.term * 12} payments</span>
      </summary>
      {open && (
        <Suspense fallback={<p className="loading">Loading amortization…</p>}>
          <AmortPanel
            loanAmount={loan.loanAmount}
            annualRatePct={centralRate}
            termYears={loan.term}
            schedule={schedule}
          />
        </Suspense>
      )}
    </details>
  );
}

function LoanCardForm({
  loan,
  states,
  counties,
  stateName,
  anchorRate,
  anchorSourceLabel,
  onChange,
}: {
  loan: LoanInstance;
  states: StatesIndex;
  counties: CountyEntry[];
  stateName: string;
  anchorRate: number | null;
  anchorSourceLabel: string;
  onChange: (patch: Partial<LoanInstance>) => void;
}) {
  const useCustom = loan.hasCustomRate;
  const rateDisplay = useCustom
    ? loan.rateText
    : anchorRate != null
      ? anchorRate.toFixed(2)
      : "";

  const rateInputId = `loan-rate-${loan.id}`;

  const RATE_STEP = 0.05;
  const stepRate = (dir: 1 | -1) => {
    const current = useCustom
      ? parseCustomRate(loan.rateText) ?? anchorRate ?? 0
      : anchorRate ?? 0;
    const next = Math.max(0, Math.min(30, current + dir * RATE_STEP));
    onChange({ rateText: next.toFixed(2), hasCustomRate: true });
  };

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
        <span>Loan structure</span>
        <select
          value={loan.productType}
          onChange={(e) => onChange({ productType: e.target.value as ProductType })}
        >
          <optgroup label="Fixed">
            {PRODUCT_OPTIONS.filter((o) => o.group === "Fixed").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Adjustable rate">
            {PRODUCT_OPTIONS.filter((o) => o.group === "ARM").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Buydown">
            {PRODUCT_OPTIONS.filter((o) => o.group === "Buydown").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        </select>
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

      <label htmlFor={rateInputId}>
        <div className="loan-form-rate-header">
          <span>Rate</span>
          {useCustom && (
            <button
              type="button"
              className="rate-reset-btn-inline"
              onClick={() => onChange({ rateText: "", hasCustomRate: false })}
              title={
                anchorRate != null
                  ? `Reset to ${anchorSourceLabel} (${anchorRate.toFixed(2)}%)`
                  : `Reset to ${anchorSourceLabel}`
              }
              aria-label="Reset rate to default"
            >
              ↺
            </button>
          )}
        </div>
        <div className="rate-field-combo">
          <input
            id={rateInputId}
            type="number"
            className="rate-field-input"
            min={0}
            max={30}
            step={0.05}
            value={rateDisplay}
            onChange={(e) => onChange({ rateText: e.target.value, hasCustomRate: true })}
          />
          <div className="rate-spin-buttons">
            <button
              type="button"
              className="rate-spin-button"
              onClick={() => stepRate(1)}
              aria-label="Increase rate by 0.05%"
              title="Increase by 0.05%"
            >
              ▲
            </button>
            <button
              type="button"
              className="rate-spin-button"
              onClick={() => stepRate(-1)}
              aria-label="Decrease rate by 0.05%"
              title="Decrease by 0.05%"
            >
              ▼
            </button>
          </div>
          {!useCustom && (
            <span className="rate-field-suffix">{anchorSourceLabel}</span>
          )}
        </div>
      </label>

      {ARM_PRODUCTS.has(loan.productType) && (
        <label>
          <span>Rate after adjustment</span>
          <input
            type="number"
            min={0}
            max={30}
            step={0.05}
            placeholder={`auto: ${(parseCustomRate(loan.rateText) ?? anchorRate ?? 0).toFixed(2)}%`}
            value={loan.hasCustomArmAdjustedRate ? loan.armAdjustedRateText : ""}
            onChange={(e) =>
              onChange({
                armAdjustedRateText: e.target.value,
                hasCustomArmAdjustedRate: true,
              })
            }
          />
        </label>
      )}
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
