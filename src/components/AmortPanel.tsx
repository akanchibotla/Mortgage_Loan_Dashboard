import { useMemo } from "react";
import { fmtMoney } from "../lib/payment";

interface AmortRow {
  month: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

interface Props {
  loanAmount: number;
  annualRatePct: number;
  termYears: number;
}

function computeSchedule(P: number, annualRatePct: number, termYears: number): AmortRow[] {
  if (
    !Number.isFinite(P) ||
    P <= 0 ||
    !Number.isFinite(annualRatePct) ||
    annualRatePct < 0 ||
    !Number.isFinite(termYears) ||
    termYears <= 0
  ) {
    return [];
  }
  const r = annualRatePct / 100 / 12;
  const n = Math.round(termYears * 12);
  const payment =
    r > 0 ? (P * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1) : P / n;
  let balance = P;
  const rows: AmortRow[] = [];
  for (let m = 1; m <= n; m++) {
    const interest = balance * r;
    const principal = Math.min(payment - interest, balance);
    balance = Math.max(0, balance - principal);
    rows.push({ month: m, payment, interest, principal, balance });
  }
  return rows;
}

export function AmortPanel({ loanAmount, annualRatePct, termYears }: Props) {
  const schedule = useMemo(
    () => computeSchedule(loanAmount, annualRatePct, termYears),
    [loanAmount, annualRatePct, termYears],
  );
  if (schedule.length === 0) {
    return <p className="loading">Enter a valid loan amount and rate to see the schedule.</p>;
  }
  const crossoverIdx = schedule.findIndex((r) => r.principal > r.interest);
  const crossoverMonth = crossoverIdx >= 0 ? crossoverIdx + 1 : -1;
  const interestY1 = schedule[0].interest;
  const interestYn = schedule[schedule.length - 1].interest;
  return (
    <div className="amort-panel">
      <AmortChart schedule={schedule} crossoverMonth={crossoverMonth} />
      <div className="amort-chart-legend">
        <span>
          <span className="amort-dot amort-dot-p" /> Principal portion
        </span>
        <span>
          <span className="amort-dot amort-dot-i" /> Interest portion
        </span>
        <span className="amort-legend-note">
          Month 1: {fmtMoney(interestY1)} interest · Month {schedule.length}:{" "}
          {fmtMoney(interestYn)} interest
        </span>
        {crossoverMonth > 0 && (
          <span className="amort-legend-cross">
            ┊ Principal &gt; interest from month {crossoverMonth} (year{" "}
            {Math.ceil(crossoverMonth / 12)})
          </span>
        )}
      </div>
      <AmortTable schedule={schedule} />
    </div>
  );
}

function AmortChart({
  schedule,
  crossoverMonth,
}: {
  schedule: AmortRow[];
  crossoverMonth: number;
}) {
  const W = 600;
  const H = 180;
  const PAD_X = 6;
  const PAD_Y = 10;
  const innerW = W - 2 * PAD_X;
  const innerH = H - 2 * PAD_Y;
  const n = schedule.length;
  const payment = schedule[0]?.payment ?? 0;
  if (n === 0 || payment <= 0) return null;

  const x = (m: number) => PAD_X + (m / n) * innerW;
  const y = (v: number) => PAD_Y + (1 - v / payment) * innerH;

  // Interest area: from baseline up to interest curve.
  let interestPath = `M ${PAD_X} ${PAD_Y + innerH}`;
  for (let i = 0; i < n; i++) {
    interestPath += ` L ${x(i + 1)} ${y(schedule[i].interest)}`;
  }
  interestPath += ` L ${x(n)} ${PAD_Y + innerH} Z`;

  // Year ticks
  const totalYears = Math.floor(n / 12);
  const ticks: number[] = [];
  for (let yr = 1; yr <= totalYears; yr++) ticks.push(yr);

  return (
    <svg
      viewBox={`0 0 ${W} ${H + 14}`}
      preserveAspectRatio="none"
      className="amort-chart"
      role="img"
      aria-label="Stacked area chart of monthly principal versus interest over the loan life"
    >
      <defs>
        <linearGradient id="amort-grad-p" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1f5fa8" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#2c75c2" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id="amort-grad-i" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c4ccd9" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#aab6c5" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      {/* Principal background fills the payment box */}
      <rect
        x={PAD_X}
        y={PAD_Y}
        width={innerW}
        height={innerH}
        fill="url(#amort-grad-p)"
      />
      {/* Interest area on top */}
      <path d={interestPath} fill="url(#amort-grad-i)" />
      {/* Year ticks */}
      {ticks.map((yr) => {
        const cx = x(yr * 12);
        const tall = yr % 5 === 0;
        return (
          <g key={yr}>
            <line
              x1={cx}
              y1={PAD_Y + innerH}
              x2={cx}
              y2={PAD_Y + innerH + (tall ? 5 : 2)}
              stroke="rgba(74, 85, 104, 0.55)"
              strokeWidth={tall ? 1.2 : 0.7}
              vectorEffect="non-scaling-stroke"
            />
            {tall && (
              <text
                x={cx}
                y={PAD_Y + innerH + 12}
                textAnchor="middle"
                fontSize="9"
                fill="#6b7280"
              >
                yr {yr}
              </text>
            )}
          </g>
        );
      })}
      {/* Crossover line */}
      {crossoverMonth > 0 && crossoverMonth <= n && (
        <line
          x1={x(crossoverMonth)}
          y1={PAD_Y}
          x2={x(crossoverMonth)}
          y2={PAD_Y + innerH}
          stroke="#143a66"
          strokeWidth={1.2}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

function AmortTable({ schedule }: { schedule: AmortRow[] }) {
  return (
    <div className="amort-table-wrap">
      <table className="amort-table">
        <thead>
          <tr>
            <th className="col-mo">#</th>
            <th>Payment</th>
            <th>Interest</th>
            <th>Principal</th>
            <th>Balance</th>
          </tr>
        </thead>
        <tbody>
          {schedule.map((row) => {
            const yearEnd = row.month % 12 === 0;
            return (
              <tr key={row.month} className={yearEnd ? "year-end" : ""}>
                <td className="col-mo">
                  {row.month}
                  {yearEnd && (
                    <span className="year-tag">yr {row.month / 12}</span>
                  )}
                </td>
                <td>{fmtMoney(row.payment)}</td>
                <td className="td-interest">{fmtMoney(row.interest)}</td>
                <td className="td-principal">{fmtMoney(row.principal)}</td>
                <td>{fmtMoney(row.balance)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
