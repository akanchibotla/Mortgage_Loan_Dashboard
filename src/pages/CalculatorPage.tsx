import {
  lazy,
  Suspense,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

// Buildup of payment phases for products where the loan itself genuinely
// changes rate (ARMs) or has no phase structure (fixed). Buydown products
// do NOT use this — their amortization is single-rate at the note rate, and
// "phases" only describe the borrower's reduced check, not the loan's actual
// behavior. See buildBuydownPlan + computeBuydownSchedule below.
function buildPhases(
  productType: ProductType,
  noteRate: number,
  armAdjustedRate: number,
  totalMonths: number,
): RatePhase[] {
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
    case "buydown-2-1":
    case "buydown-1-0":
    case "buydown-3-2-1":
      // Buydowns don't have phased *loan* amortization — they amortize as a
      // single fixed-rate loan at the note rate. The schedule path for them
      // goes through buildBuydownPlan + computeBuydownSchedule, not here.
      return [{ months: totalMonths, rate: noteRate, label: "Note rate" }];
  }
}

// A buydown "phase" is purely about the borrower's monthly check — the loan
// itself amortizes at the note rate throughout. `rateReduction` is the
// percentage points subtracted from the note rate when computing the
// borrower's bought-down payment per Fannie Mae Selling Guide B5-5.1-04.
interface BuydownPhase {
  months: number;
  rateReduction: number;
  label: string;
}

function buildBuydownPlan(productType: ProductType, totalMonths: number): BuydownPhase[] {
  switch (productType) {
    case "buydown-2-1": {
      const tail = Math.max(0, totalMonths - 24);
      return [
        { months: Math.min(12, totalMonths), rateReduction: 2, label: "Year 1" },
        { months: Math.min(12, Math.max(0, totalMonths - 12)), rateReduction: 1, label: "Year 2" },
        ...(tail > 0 ? [{ months: tail, rateReduction: 0, label: "Year 3+" }] : []),
      ];
    }
    case "buydown-1-0": {
      const tail = Math.max(0, totalMonths - 12);
      return [
        { months: Math.min(12, totalMonths), rateReduction: 1, label: "Year 1" },
        ...(tail > 0 ? [{ months: tail, rateReduction: 0, label: "Year 2+" }] : []),
      ];
    }
    case "buydown-3-2-1": {
      const tail = Math.max(0, totalMonths - 36);
      return [
        { months: Math.min(12, totalMonths), rateReduction: 3, label: "Year 1" },
        { months: Math.min(12, Math.max(0, totalMonths - 12)), rateReduction: 2, label: "Year 2" },
        { months: Math.min(12, Math.max(0, totalMonths - 24)), rateReduction: 1, label: "Year 3" },
        ...(tail > 0 ? [{ months: tail, rateReduction: 0, label: "Year 4+" }] : []),
      ];
    }
    default:
      return [{ months: totalMonths, rateReduction: 0, label: "Note rate" }];
  }
}

interface ScheduleRow {
  month: number;
  // `payment` is what the LENDER collects this month. For fixed and ARM this
  // equals the borrower's check; for buydowns it is the constant full
  // note-rate payment regardless of phase.
  payment: number;
  // `borrowerPayment` is what the BORROWER writes a check for. Equal to
  // `payment` for fixed and ARM. Reduced during buydown years per the
  // bought-down rate; returns to `payment` once the buydown period ends.
  borrowerPayment: number;
  // `subsidy` = payment − borrowerPayment. Funded upfront by seller/builder/
  // lender; held in a subsidy account; drawn by the servicer each month
  // during the buydown period to make the lender's payment whole. Zero for
  // non-buydown products.
  subsidy: number;
  // Interest/principal/balance reflect the LOAN's actual amortization, which
  // for buydowns is at the note rate (NOT the bought-down rate). This is the
  // critical correctness fix: prior version re-amortized at the discounted
  // rate during buydown years, which overstated principal paydown and
  // understated the balance carried forward.
  interest: number;
  principal: number;
  balance: number;
}

const BUYDOWN_PRODUCTS = new Set<ProductType>([
  "buydown-2-1",
  "buydown-1-0",
  "buydown-3-2-1",
]);

function isBuydown(p: ProductType): boolean {
  return BUYDOWN_PRODUCTS.has(p);
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
  if (isBuydown(productType)) {
    return computeBuydownSchedule(loanAmount, productType, noteRate, termYears, totalMonths);
  }
  // Fixed and ARM share the multi-phase amortization model — the loan
  // genuinely re-amortizes at each phase boundary (ARM adjustment).
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
        borrowerPayment: phasePayment,
        subsidy: 0,
        interest,
        principal,
        balance,
      });
    }
    monthsRemaining -= phase.months;
  }
  return rows;
}

function computeBuydownSchedule(
  loanAmount: number,
  productType: ProductType,
  noteRate: number,
  termYears: number,
  totalMonths: number,
): ScheduleRow[] {
  // The loan itself is a standard fixed-rate mortgage at `noteRate` over the
  // full term. The lender amortizes that one schedule — never re-amortizes
  // for the discounted rate. The borrower's check during buydown years is
  // computed *as if* it were a fixed loan at (noteRate − reduction) on the
  // ORIGINAL balance for the FULL term (Fannie convention) — this gives the
  // dollar-flat per-year buydown payment that appears on the buydown
  // agreement at closing.
  const notePayment = monthlyPayment(loanAmount, noteRate, termYears);
  const plan = buildBuydownPlan(productType, totalMonths);
  const phaseBorrowerPayments = plan.map((p) => ({
    months: p.months,
    label: p.label,
    borrowerPayment: monthlyPayment(
      loanAmount,
      Math.max(0, noteRate - p.rateReduction),
      termYears,
    ),
  }));

  const r = noteRate / 100 / 12;
  const rows: ScheduleRow[] = [];
  let balance = loanAmount;
  let phaseIdx = 0;
  let monthsInPhase = 0;
  for (let m = 1; m <= totalMonths; m++) {
    // Advance to the next phase that still has months left.
    while (
      phaseIdx < phaseBorrowerPayments.length &&
      monthsInPhase >= phaseBorrowerPayments[phaseIdx].months
    ) {
      phaseIdx++;
      monthsInPhase = 0;
    }
    const currentBorrower =
      phaseBorrowerPayments[phaseIdx]?.borrowerPayment ?? notePayment;
    const interest = balance * r;
    const principal = Math.min(notePayment - interest, balance);
    balance = Math.max(0, balance - principal);
    rows.push({
      month: m,
      payment: notePayment,
      borrowerPayment: currentBorrower,
      subsidy: Math.max(0, notePayment - currentBorrower),
      interest,
      principal,
      balance,
    });
    monthsInPhase++;
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

  if (isBuydown(productType)) {
    // Buydown "phase payment" = the borrower's monthly check during that
    // phase, computed at the bought-down effective rate on the original
    // balance for the full term (Fannie convention). The `rate` field
    // surfaces that effective rate so the loan card can label it clearly.
    const plan = buildBuydownPlan(productType, totalMonths);
    return plan
      .filter((p) => p.months > 0)
      .map((p) => {
        const effectiveRate = Math.max(0, noteRate - p.rateReduction);
        return {
          label: p.label,
          rate: effectiveRate,
          payment: monthlyPayment(loanAmount, effectiveRate, termYears),
        };
      });
  }

  // Fixed and ARM: payment really does change between phases because the
  // loan re-amortizes at the new rate on the remaining balance.
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

// Total upfront cost of the buydown — the dollar amount that must be
// deposited into the subsidy account at closing. Sum of the per-month
// (notePayment − borrowerPayment) across the buydown period. Zero for
// non-buydown products. Used by the loan card to surface the real cost
// that the seller/builder/lender is paying.
function computeBuydownSubsidyTotal(
  loanAmount: number,
  productType: ProductType,
  noteRate: number,
  termYears: number,
): number {
  if (!isBuydown(productType)) return 0;
  const totalMonths = Math.round(termYears * 12);
  if (!Number.isFinite(loanAmount) || loanAmount <= 0 || totalMonths <= 0) return 0;
  const notePayment = monthlyPayment(loanAmount, noteRate, termYears);
  const plan = buildBuydownPlan(productType, totalMonths);
  let total = 0;
  for (const p of plan) {
    if (p.months <= 0) continue;
    const effectiveRate = Math.max(0, noteRate - p.rateReduction);
    const borrowerPayment = monthlyPayment(loanAmount, effectiveRate, termYears);
    total += Math.max(0, notePayment - borrowerPayment) * p.months;
  }
  return total;
}

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

  // Align ".loan-card-top" (form + HMDA block) and ".loan-block-output"
  // (Monthly P&I) heights across every comparison card so the P&I label
  // and the "See month-by-month amortization" button each sit on a
  // shared y across all cards regardless of which loan structure / state
  // is selected. Re-measures when loans change or the window resizes.
  const gridRef = useRef<HTMLDivElement>(null);
  const [resizeTick, setResizeTick] = useState(0);

  const measureSections = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    // Reset CSS variables so the next measurement sees the natural height,
    // not the previously-applied min-height floor.
    grid.style.setProperty("--card-top-min", "auto");
    grid.style.setProperty("--card-pi-min", "auto");
    grid.style.setProperty("--card-min-open", "auto");
    // Force a synchronous reflow before reading offsetHeight.
    void grid.offsetHeight;
    const tops = grid.querySelectorAll<HTMLElement>(".loan-card-top");
    const pis = grid.querySelectorAll<HTMLElement>(".loan-block-output");
    const cards = grid.querySelectorAll<HTMLElement>(".loan-card");
    let topMax = 0;
    tops.forEach((el) => {
      if (el.offsetHeight > topMax) topMax = el.offsetHeight;
    });
    let piMax = 0;
    pis.forEach((el) => {
      if (el.offsetHeight > piMax) piMax = el.offsetHeight;
    });
    // Among cards whose amortization disclosure is currently open, take the
    // tallest. That becomes the min-height floor applied to every open card
    // so different loan types (fixed / ARM / buydown — each with different
    // phase rows, explainer notes, and per-month buydown breakdowns) all
    // bottom-align when expanded. Closed cards are NOT constrained — they
    // stay at their natural shorter height, matching the existing behavior
    // where opening one card doesn't drag closed siblings taller.
    let openCardMax = 0;
    cards.forEach((card) => {
      const details = card.querySelector<HTMLDetailsElement>(".loan-amort-details");
      if (details?.open && card.offsetHeight > openCardMax) {
        openCardMax = card.offsetHeight;
      }
    });
    if (topMax > 0) grid.style.setProperty("--card-top-min", `${topMax}px`);
    if (piMax > 0) grid.style.setProperty("--card-pi-min", `${piMax}px`);
    if (openCardMax > 0) grid.style.setProperty("--card-min-open", `${openCardMax}px`);
  }, []);

  useLayoutEffect(() => {
    measureSections();
  }, [measureSections, loans, resizeTick]);

  useEffect(() => {
    const onResize = () => setResizeTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Re-measure whenever any amort disclosure toggles. The native `toggle`
  // event on a <details> element does NOT bubble, so we have to attach in
  // capture phase at the grid level — that still catches it during the
  // descent. Without this hook, expanding a card after mount would leave
  // --card-min-open stale and the cards wouldn't equalize.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const onToggle = () => setResizeTick((t) => t + 1);
    grid.addEventListener("toggle", onToggle, true);
    return () => grid.removeEventListener("toggle", onToggle, true);
  }, []);

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

      <div className={`calc-compare-grid cols-${cols}`} ref={gridRef}>
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
    ? `${county!.name} County (${countyDist.n_loans.toLocaleString()} closed loans)`
    : stateHmda?.n_loans
      ? `${data.meta.name} (${stateHmda.n_loans.toLocaleString()} closed loans)`
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
      <div className="loan-card-top">
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
                <span className="k">best 10%</span>
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
                <span className="k">worst 10%</span>
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
      </div>

      <PhasePaymentBlock
        loan={loan}
        centralRate={centralRate}
        centralLabel={centralLabel}
        p10={p10}
        p90={p90}
      />

      <div className="loan-card-spacer" aria-hidden="true" />

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
      <div className="loan-card-top">
        <LoanCardForm
          loan={loan}
          states={states}
          counties={[]}
          stateName=""
          anchorRate={usRate}
          anchorSourceLabel={anchorSourceLabel}
          onChange={onChange}
        />
      </div>

      <PhasePaymentBlock
        loan={loan}
        centralRate={centralRate}
        centralLabel={centralLabel}
      />

      <div className="loan-card-spacer" aria-hidden="true" />

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
  const buydown = isBuydown(loan.productType);
  // Pre-compute the buydown-specific extras once. The lender's collected
  // payment is the full P&I at the note rate — constant for the whole term,
  // including the buydown years. The subsidy total is the upfront pool the
  // seller/builder/lender deposits at closing.
  const buydownLenderPayment = buydown
    ? monthlyPayment(loan.loanAmount, centralRate, loan.term)
    : 0;
  const buydownSubsidyTotal = buydown
    ? computeBuydownSubsidyTotal(loan.loanAmount, loan.productType, centralRate, loan.term)
    : 0;
  // For buydown loans the headline shifts from "Monthly P&I" (which would be
  // misleading — the borrower's check varies by year) to "Your monthly
  // payment". A footnote restores the loan's true amortization view.
  const headline = buydown
    ? "Your monthly payment"
    : "Monthly P&I";
  return (
    <div className="loan-block loan-block-output">
      <h4 className="loan-block-h">
        {headline} — ${loan.loanAmount.toLocaleString()}
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
        {buydown && (
          <>
            <li className="loan-stats-aside">
              <span className="k">Lender amortizes at {centralRate.toFixed(2)}% throughout</span>
              <span className="v">${Math.round(buydownLenderPayment).toLocaleString()}/mo</span>
            </li>
            <li className="loan-stats-aside">
              <span className="k">Upfront subsidy (seller/builder/lender funds)</span>
              <span className="v">${Math.round(buydownSubsidyTotal).toLocaleString()}</span>
            </li>
          </>
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
  // Translate the product-type vocabulary used by the calculator into the
  // narrower "what kind of explainer note" hint the panel needs. Buydowns
  // can also be detected from the subsidy field, but ARMs require this hint
  // to surface their explainer (their default schedule looks like a fixed
  // loan when the user hasn't customized the adjusted rate).
  const productHint: "fixed" | "arm" | "buydown" = isBuydown(loan.productType)
    ? "buydown"
    : ARM_PRODUCTS.has(loan.productType)
      ? "arm"
      : "fixed";
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
            productHint={productHint}
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
        <div className="product-toggle">
          <div className="product-group">
            <span className="product-group-label">Fixed</span>
            <div className="product-pills">
              <button
                type="button"
                className={`product-pill ${loan.productType === "fixed" ? "active" : ""}`}
                onClick={() => onChange({ productType: "fixed" })}
              >
                Fixed-rate
              </button>
            </div>
          </div>
          <div className="product-group">
            <span className="product-group-label">ARM</span>
            <div className="product-pills">
              <button
                type="button"
                className={`product-pill ${loan.productType === "arm-7-1" ? "active" : ""}`}
                onClick={() => onChange({ productType: "arm-7-1" })}
              >
                7/1
              </button>
              <button
                type="button"
                className={`product-pill ${loan.productType === "arm-5-1" ? "active" : ""}`}
                onClick={() => onChange({ productType: "arm-5-1" })}
              >
                5/1
              </button>
            </div>
          </div>
          <div className="product-group">
            <span className="product-group-label">Buydown</span>
            <div className="product-pills">
              <button
                type="button"
                className={`product-pill ${loan.productType === "buydown-2-1" ? "active" : ""}`}
                onClick={() => onChange({ productType: "buydown-2-1" })}
              >
                2-1
              </button>
              <button
                type="button"
                className={`product-pill ${loan.productType === "buydown-1-0" ? "active" : ""}`}
                onClick={() => onChange({ productType: "buydown-1-0" })}
              >
                1-0
              </button>
              <button
                type="button"
                className={`product-pill ${loan.productType === "buydown-3-2-1" ? "active" : ""}`}
                onClick={() => onChange({ productType: "buydown-3-2-1" })}
              >
                3-2-1
              </button>
            </div>
          </div>
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

      {ARM_PRODUCTS.has(loan.productType) && (() => {
        const armRateInputId = `loan-arm-rate-${loan.id}`;
        const baseRate = parseCustomRate(loan.rateText) ?? anchorRate ?? 0;
        const armUseCustom = loan.hasCustomArmAdjustedRate;
        const armRateDisplay = armUseCustom
          ? loan.armAdjustedRateText
          : baseRate.toFixed(2);
        const stepArmRate = (dir: 1 | -1) => {
          const current = armUseCustom
            ? parseCustomRate(loan.armAdjustedRateText) ?? baseRate
            : baseRate;
          const next = Math.max(0, Math.min(30, current + dir * RATE_STEP));
          onChange({
            armAdjustedRateText: next.toFixed(2),
            hasCustomArmAdjustedRate: true,
          });
        };
        return (
          <label htmlFor={armRateInputId}>
            <div className="loan-form-rate-header">
              <span>Rate after adjustment</span>
              {armUseCustom && (
                <button
                  type="button"
                  className="rate-reset-btn-inline"
                  onClick={() =>
                    onChange({
                      armAdjustedRateText: "",
                      hasCustomArmAdjustedRate: false,
                    })
                  }
                  title={`Reset to follow the main rate (${baseRate.toFixed(2)}%)`}
                  aria-label="Reset adjusted rate to follow main rate"
                >
                  ↺
                </button>
              )}
            </div>
            <div className="rate-field-combo">
              <input
                id={armRateInputId}
                type="number"
                className="rate-field-input"
                min={0}
                max={30}
                step={0.05}
                value={armRateDisplay}
                onChange={(e) =>
                  onChange({
                    armAdjustedRateText: e.target.value,
                    hasCustomArmAdjustedRate: true,
                  })
                }
              />
              <div className="rate-spin-buttons">
                <button
                  type="button"
                  className="rate-spin-button"
                  onClick={() => stepArmRate(1)}
                  aria-label="Increase rate by 0.05%"
                  title="Increase by 0.05%"
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="rate-spin-button"
                  onClick={() => stepArmRate(-1)}
                  aria-label="Decrease rate by 0.05%"
                  title="Decrease by 0.05%"
                >
                  ▼
                </button>
              </div>
            </div>
          </label>
        );
      })()}
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
