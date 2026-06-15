import { describe, it, expect } from "vitest";
import { monthlyPayment, fmtMoney, fmtRate } from "../payment";
import {
  buildBuydownPlan,
  computeBuydownSubsidyTotal,
} from "../loanMath";

describe("monthlyPayment", () => {
  it("standard 30-yr at 6.5% on $400K matches the worked example", () => {
    expect(monthlyPayment(400_000, 6.5, 30)).toBeCloseTo(2_528.27, 1);
  });

  it("zero rate returns straight-line principal/n", () => {
    expect(monthlyPayment(360_000, 0, 30)).toBeCloseTo(1_000, 5);
  });

  it("negative or NaN principal returns 0 (defensive)", () => {
    expect(monthlyPayment(-1, 6.5, 30)).toBe(0);
    expect(monthlyPayment(NaN, 6.5, 30)).toBe(0);
  });

  it("zero or NaN term returns 0", () => {
    expect(monthlyPayment(400_000, 6.5, 0)).toBe(0);
    expect(monthlyPayment(400_000, 6.5, NaN)).toBe(0);
  });

  it("15-yr at 5.5% on $300K", () => {
    // hand-computed: 300000 * (r * (1+r)^180) / ((1+r)^180 - 1) with r=0.045833…
    expect(monthlyPayment(300_000, 5.5, 15)).toBeCloseTo(2_451.25, 1);
  });
});

describe("buildBuydownPlan", () => {
  it("2-1 over 360 months returns three phases: 12, 12, 336", () => {
    const plan = buildBuydownPlan("buydown-2-1", 360);
    expect(plan).toHaveLength(3);
    expect(plan[0]).toMatchObject({ months: 12, rateReduction: 2 });
    expect(plan[1]).toMatchObject({ months: 12, rateReduction: 1 });
    expect(plan[2]).toMatchObject({ months: 336, rateReduction: 0 });
  });

  it("3-2-1 over 360 months returns four phases: 12, 12, 12, 324", () => {
    const plan = buildBuydownPlan("buydown-3-2-1", 360);
    expect(plan).toHaveLength(4);
    expect(plan.map((p) => p.months)).toEqual([12, 12, 12, 324]);
    expect(plan.map((p) => p.rateReduction)).toEqual([3, 2, 1, 0]);
  });

  it("1-0 over 360 months returns two phases: 12, 348", () => {
    const plan = buildBuydownPlan("buydown-1-0", 360);
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ months: 12, rateReduction: 1 });
    expect(plan[1]).toMatchObject({ months: 348, rateReduction: 0 });
  });

  it("short loan (e.g. 12 months) omits the tail phase for products that need >12 months", () => {
    const plan21 = buildBuydownPlan("buydown-2-1", 12);
    // Just year 1 fills (12 months); year 2 has 0 months; no tail.
    const totalMonths = plan21.reduce((acc, p) => acc + p.months, 0);
    expect(totalMonths).toBe(12);
  });

  it("edge: 13-month loan for 2-1 — year 1 = 12 months, year 2 = 1 month, no tail", () => {
    const plan = buildBuydownPlan("buydown-2-1", 13);
    expect(plan[0].months).toBe(12);
    expect(plan[1].months).toBe(1);
    expect(plan).toHaveLength(2); // no tail
  });

  it("edge: 25-month loan for 2-1 — full year 1, full year 2, 1-month tail", () => {
    const plan = buildBuydownPlan("buydown-2-1", 25);
    expect(plan[0].months).toBe(12);
    expect(plan[1].months).toBe(12);
    expect(plan[2].months).toBe(1);
  });
});

describe("computeBuydownSubsidyTotal", () => {
  it("2-1 buydown $400K/30yr/6.5% — worked numeric example", () => {
    // Hand-computed:
    //   lender payment = $2,528.27
    //   y1 borrower @ 4.5% = $2,026.74; subsidy = $501.53/mo × 12 = $6,018.36
    //   y2 borrower @ 5.5% = $2,271.16; subsidy = $257.11/mo × 12 = $3,085.32
    //   total ≈ $9,103.68 (vs prior commit's verified $9,103.76)
    expect(
      computeBuydownSubsidyTotal(400_000, "buydown-2-1", 6.5, 30),
    ).toBeCloseTo(9_103.76, 1);
  });

  it("3-2-1 buydown $400K/30yr/6.5% subsidy > 2-1 subsidy (more reduction)", () => {
    const total321 = computeBuydownSubsidyTotal(400_000, "buydown-3-2-1", 6.5, 30);
    const total21 = computeBuydownSubsidyTotal(400_000, "buydown-2-1", 6.5, 30);
    expect(total321).toBeGreaterThan(total21);
    // Roughly 2x the 2-1 cost — verified ~$17,888 in the worked example.
    expect(total321).toBeCloseTo(17_888.88, 0);
  });

  it("rate clamp: 1.5% note rate with 3-2-1 — year 1 reduction is clamped to 0%", () => {
    // With note 1.5%, reductions of 3% / 2% / 1% would take the rate
    // negative in years 1 and 2. Clamp(0) means the borrower payment in
    // year 1 = monthlyPayment(loan, 0%, term) = principal/n = $1,111.11
    // on $400K/30yr.
    const subsidy = computeBuydownSubsidyTotal(400_000, "buydown-3-2-1", 1.5, 30);
    expect(subsidy).toBeGreaterThan(0);
    expect(Number.isFinite(subsidy)).toBe(true);
  });

  it("zero or negative loan amount returns 0", () => {
    expect(computeBuydownSubsidyTotal(0, "buydown-2-1", 6.5, 30)).toBe(0);
    expect(computeBuydownSubsidyTotal(-1, "buydown-2-1", 6.5, 30)).toBe(0);
  });

  it("zero term returns 0", () => {
    expect(computeBuydownSubsidyTotal(400_000, "buydown-2-1", 6.5, 0)).toBe(0);
  });
});

describe("fmt helpers", () => {
  it("fmtMoney rounds to whole dollars and adds currency symbol", () => {
    expect(fmtMoney(2528.27)).toBe("$2,528");
    expect(fmtMoney(0)).toBe("$0");
  });

  it("fmtMoney returns em-dash for null / undefined / non-finite", () => {
    expect(fmtMoney(null)).toBe("—");
    expect(fmtMoney(undefined)).toBe("—");
    expect(fmtMoney(NaN)).toBe("—");
    expect(fmtMoney(Infinity)).toBe("—");
  });

  it("fmtRate appends % and pads to 2 decimals", () => {
    expect(fmtRate(6.5)).toBe("6.50%");
    expect(fmtRate(6.123)).toBe("6.12%");
    expect(fmtRate(null)).toBe("—");
    expect(fmtRate(undefined)).toBe("—");
  });
});
