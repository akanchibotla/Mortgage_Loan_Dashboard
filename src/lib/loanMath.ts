import { monthlyPayment } from "./payment";

export type BuydownProduct = "buydown-2-1" | "buydown-1-0" | "buydown-3-2-1";

export interface BuydownPhase {
  months: number;
  rateReduction: number; // percentage points subtracted from note rate
  label: string;
}

/**
 * Build the per-phase buydown plan describing the borrower's effective
 * rate reduction over time. The lender amortizes at the full note rate
 * throughout — these phases only describe the borrower's check, not the
 * loan's actual rate.
 *
 * Phase boundaries follow Fannie Mae Selling Guide B5-5.1-04 conventions.
 */
export function buildBuydownPlan(
  productType: BuydownProduct,
  totalMonths: number,
): BuydownPhase[] {
  switch (productType) {
    case "buydown-2-1": {
      const tail = Math.max(0, totalMonths - 24);
      return [
        { months: Math.min(12, totalMonths), rateReduction: 2, label: "Year 1" },
        {
          months: Math.min(12, Math.max(0, totalMonths - 12)),
          rateReduction: 1,
          label: "Year 2",
        },
        ...(tail > 0
          ? [{ months: tail, rateReduction: 0, label: "Year 3+" }]
          : []),
      ];
    }
    case "buydown-1-0": {
      const tail = Math.max(0, totalMonths - 12);
      return [
        { months: Math.min(12, totalMonths), rateReduction: 1, label: "Year 1" },
        ...(tail > 0
          ? [{ months: tail, rateReduction: 0, label: "Year 2+" }]
          : []),
      ];
    }
    case "buydown-3-2-1": {
      const tail = Math.max(0, totalMonths - 36);
      return [
        { months: Math.min(12, totalMonths), rateReduction: 3, label: "Year 1" },
        {
          months: Math.min(12, Math.max(0, totalMonths - 12)),
          rateReduction: 2,
          label: "Year 2",
        },
        {
          months: Math.min(12, Math.max(0, totalMonths - 24)),
          rateReduction: 1,
          label: "Year 3",
        },
        ...(tail > 0
          ? [{ months: tail, rateReduction: 0, label: "Year 4+" }]
          : []),
      ];
    }
  }
}

/**
 * Total upfront cost of the buydown — the dollar amount that must be
 * deposited into the subsidy account at closing. Sum of the per-month
 * (notePayment − borrowerPayment) across the buydown period.
 *
 * Borrower payment per phase is computed at the bought-down effective
 * rate on the ORIGINAL balance for the FULL term (Fannie Mae convention),
 * with a 0% floor for rates that would go negative on a very-low-note
 * starting point.
 */
export function computeBuydownSubsidyTotal(
  loanAmount: number,
  productType: BuydownProduct,
  noteRate: number,
  termYears: number,
): number {
  const totalMonths = Math.round(termYears * 12);
  if (!Number.isFinite(loanAmount) || loanAmount <= 0 || totalMonths <= 0) {
    return 0;
  }
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
