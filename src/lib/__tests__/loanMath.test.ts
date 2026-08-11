import { describe, it, expect } from "vitest";
import { monthlyPayment, fmtMoney, fmtRate } from "../payment";
import {
  buildBuydownPlan,
  computeBuydownSubsidyTotal,
} from "../loanMath";

describe("monthlyPayment", () => {
  it("standard 30-yr at 6.5% on $400K matches the worked example", () => {
    expect(monthlyPayment(400_000, 6.5, 30)).toBeCloseTo(2_528.272094, 2);
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
    // hand-computed: 300000 * (r * (1+r)^180) / ((1+r)^180 - 1) with r=0.0045833…
    expect(monthlyPayment(300_000, 5.5, 15)).toBeCloseTo(2_451.250364, 2);
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
    // Verified against the implementation, full precision:
    //   lender payment       @ 6.5% = $2,528.272094
    //   y1 borrower          @ 4.5% = $2,026.741239 → leg = $6,018.370256
    //   y2 borrower          @ 5.5% = $2,271.156005 → leg = $3,085.393063
    //   total                              = $9,103.763319
    // The previous comment rounded each leg independently and then wrote a
    // total ($9,103.68) that its own arithmetic did not produce.
    expect(
      computeBuydownSubsidyTotal(400_000, "buydown-2-1", 6.5, 30),
    ).toBeCloseTo(9_103.763319, 2);
  });

  it("3-2-1 buydown $400K/30yr/6.5% subsidy > 2-1 subsidy (more reduction)", () => {
    const total321 = computeBuydownSubsidyTotal(400_000, "buydown-3-2-1", 6.5, 30);
    const total21 = computeBuydownSubsidyTotal(400_000, "buydown-2-1", 6.5, 30);
    expect(total321).toBeGreaterThan(total21);
    // Roughly 2x the 2-1 cost — verified $17,888.883432.
    expect(total321).toBeCloseTo(17_888.883432, 2);
  });

  it("rate clamp: 1.5% note rate with 3-2-1 — year 1 reduction is clamped to 0%", () => {
    // With note 1.5%, reductions of 3% / 2% / 1% would take the rate
    // negative in years 1 and 2. Clamp(0) means the borrower payment in
    // years 1 and 2 = monthlyPayment(loan, 0%, term) = principal/n =
    // $1,111.11 on $400K/30yr, so both legs are identical:
    //   note @ 1.5%                        = $1,380.480842
    //   y1 @ 0% (clamped from −1.5%) → leg = $3,232.436769
    //   y2 @ 0% (clamped from −0.5%) → leg = $3,232.436769
    //   y3 @ 0.5%                    → leg = $2,204.673755
    //   total                              = $8,669.547292
    // `> 0 && isFinite` passed for any positive number and would not have
    // caught a broken clamp; this pins the value the clamp actually produces.
    const subsidy = computeBuydownSubsidyTotal(400_000, "buydown-3-2-1", 1.5, 30);
    expect(subsidy).toBeCloseTo(8_669.547292, 2);
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
