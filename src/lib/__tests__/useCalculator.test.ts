import { describe, it, expect } from "vitest";
import { clampLoanAmount, LOAN_MIN, LOAN_MAX } from "../useCalculator";

// W4.4 pin. The loan amount is SHARED context: three pages write it, and
// before this clamp each enforced its own bound (the state dashboard enforced
// none at all). A $1T typed on /state/california followed the context onto
// the home page, whose input advertises a much smaller max.

describe("clampLoanAmount", () => {
  it("clamps an absurd amount down to the one agreed ceiling", () => {
    expect(clampLoanAmount(1_000_000_000_000)).toBe(LOAN_MAX);
  });

  it("clamps below-floor input up to the floor", () => {
    expect(clampLoanAmount(-1)).toBe(LOAN_MIN);
  });

  it("leaves an in-range amount untouched", () => {
    expect(clampLoanAmount(350_000)).toBe(350_000);
    expect(clampLoanAmount(LOAN_MAX)).toBe(LOAN_MAX);
  });

  it("keeps the floor at 0 so a controlled field stays typeable", () => {
    // Deliberately NOT 50,000: these inputs are controlled, so a non-zero
    // floor rewrites the value while the user is still typing the first
    // digits. Commit ad0259cf records [0, 3M] as the spec.
    expect(LOAN_MIN).toBe(0);
    expect(clampLoanAmount(0)).toBe(0);
  });

  it("falls back to a sane default rather than propagating NaN", () => {
    expect(Number.isFinite(clampLoanAmount(NaN))).toBe(true);
    expect(Number.isFinite(clampLoanAmount(Infinity))).toBe(true);
  });
});
