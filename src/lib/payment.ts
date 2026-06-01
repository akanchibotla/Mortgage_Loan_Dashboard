export function monthlyPayment(
  principal: number,
  annualRatePct: number,
  termYears: number,
): number {
  if (!Number.isFinite(principal) || principal <= 0) return 0;
  if (!Number.isFinite(annualRatePct) || !Number.isFinite(termYears) || termYears <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  const n = termYears * 12;
  if (r <= 0) return principal / n;
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
  return v != null ? `${v.toFixed(2)}%` : "—";
}
