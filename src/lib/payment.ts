export function monthlyPayment(
  principal: number,
  annualRatePct: number,
  termYears: number,
): number {
  if (!Number.isFinite(principal) || principal <= 0) return 0;
  if (!Number.isFinite(annualRatePct) || !Number.isFinite(termYears) || termYears <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  const n = termYears * 12;
  // ONLY exactly-zero needs the straight-line special case: the annuity
  // formula's denominator ((1+r)^n − 1) is zero only at r === 0. The old
  // `r <= 0` routed negative rates into principal/n as well, which is not
  // a defensive fallback but a wrong answer — at −5% on $350K/30yr it
  // returns $972 where the annuity formula gives the correct $417.
  if (r === 0) return principal / n;
  return (principal * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);
}

export function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function fmtRate(v: number | null | undefined): string {
  // Mirrors fmtMoney's guard: `NaN.toFixed(2)` renders the literal string
  // "NaN%" on screen, which reads as a real rate rather than missing data.
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}
