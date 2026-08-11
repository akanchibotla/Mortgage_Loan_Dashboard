import { describe, it, expect } from "vitest";
import { monthlyPayment, fmtRate } from "../payment";

// Regression pins for the two payment.ts defects fixed in W4.3 / W4.8.
// The broader worked examples for monthlyPayment live alongside the buydown
// math in loanMath.test.ts; these cover the guards specifically.

describe("monthlyPayment — rate-sign boundary", () => {
  it("a negative rate uses the annuity formula, NOT the zero-interest branch", () => {
    // The old guard was `if (r <= 0) return principal / n`, which routed
    // every negative rate into straight-line principal/n. On $350K/30yr at
    // −5% that answered $972.22 where the annuity formula gives $417.17 —
    // 133% too high, rendered with no warning of any kind.
    expect(monthlyPayment(350_000, -5, 30)).toBeCloseTo(417.172589, 2);
    expect(monthlyPayment(350_000, -5, 30)).not.toBeCloseTo(972.22, 2);
  });

  it("exactly zero still takes the straight-line branch", () => {
    // r === 0 is the only value where the annuity denominator ((1+r)^n − 1)
    // is zero, so it is the only value that needs the special case.
    expect(monthlyPayment(360_000, 0, 30)).toBeCloseTo(1_000, 5);
  });
});

describe("fmtRate — non-finite guard", () => {
  it("returns the em-dash for NaN and Infinity, matching fmtMoney", () => {
    // Unguarded, `NaN.toFixed(2)` renders the literal string "NaN%" on
    // screen, which reads as a real rate rather than as missing data.
    expect(fmtRate(NaN)).toBe("—");
    expect(fmtRate(Infinity)).toBe("—");
    expect(fmtRate(-Infinity)).toBe("—");
  });

  it("still formats finite values and nullish input unchanged", () => {
    expect(fmtRate(6.5)).toBe("6.50%");
    expect(fmtRate(null)).toBe("—");
    expect(fmtRate(undefined)).toBe("—");
  });
});
