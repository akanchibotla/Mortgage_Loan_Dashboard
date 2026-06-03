import { Fragment, useMemo, useState } from "react";
import type { DailyRatePoint, MonthlyRate, NcMonthlySnapshot } from "../types";

interface Props {
  usData: MonthlyRate[];
  ncData: NcMonthlySnapshot[];
  mndData?: NcMonthlySnapshot[];
  nwData?: NcMonthlySnapshot[];
  mndDaily?: DailyRatePoint[];
  stateLabel?: string;
}

const EMDASH = "—";

interface WeekRow {
  weekStart: string; // ISO date (Monday)
  weekLabel: string; // human-readable "Jun 1 – Jun 7"
  avg: number;
  n: number;
}

function isoMondayOf(dateIso: string): string {
  const d = new Date(dateIso + "T00:00:00Z");
  const dow = d.getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7; // distance back to Monday
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

function shortMd(dateIso: string): string {
  const d = new Date(dateIso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function weeklyAvgsForMonth(daily: DailyRatePoint[] | undefined, ym: string): WeekRow[] {
  if (!daily) return [];
  const byWeek = new Map<string, number[]>();
  for (const p of daily) {
    if (p.rate == null) continue;
    if (p.date.slice(0, 7) !== ym) continue;
    const wk = isoMondayOf(p.date);
    const arr = byWeek.get(wk) ?? [];
    arr.push(p.rate);
    byWeek.set(wk, arr);
  }
  return Array.from(byWeek.entries())
    .sort()
    .map(([weekStart, vals]) => {
      const sundayMs = new Date(weekStart + "T00:00:00Z").getTime() + 6 * 24 * 60 * 60 * 1000;
      const sundayIso = new Date(sundayMs).toISOString().slice(0, 10);
      return {
        weekStart,
        weekLabel: `${shortMd(weekStart)} – ${shortMd(sundayIso)}`,
        avg: vals.reduce((a, b) => a + b, 0) / vals.length,
        n: vals.length,
      };
    });
}

export function RateTable({ usData, ncData, mndData, nwData, mndDaily, stateLabel }: Props) {
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const usByMonth = useMemo(() => new Map(usData.map((p) => [p.month, p.rate])), [usData]);
  const mndByMonth = useMemo(
    () => new Map((mndData ?? []).map((p) => [p.m, p.rate])),
    [mndData],
  );
  const nwByMonth = useMemo(
    () => new Map((nwData ?? []).map((p) => [p.m, p.rate])),
    [nwData],
  );
  const showNw = (nwData ?? []).some((p) => p.rate != null);
  const colCount = showNw ? 5 : 4;

  const stateCol = stateLabel ? `${stateLabel} (Bankrate)` : "State (Bankrate)";

  return (
    <table>
      <thead>
        <tr>
          <th>Month</th>
          <th>U.S. (PMMS)</th>
          <th>{stateCol}</th>
          <th>MND</th>
          {showNw && <th>NerdWallet</th>}
        </tr>
      </thead>
      <tbody>
        {ncData.map((p) => {
          const us = usByMonth.get(p.m);
          const mnd = mndByMonth.get(p.m);
          const nw = nwByMonth.get(p.m);
          const weeks = weeklyAvgsForMonth(mndDaily, p.m);
          const hasWeeks = weeks.length > 0;
          const expanded = expandedMonth === p.m;

          const usCell = us != null ? `${us.toFixed(2)}%` : EMDASH;
          const ncCell = p.rate != null ? `${p.rate.toFixed(2)}%` : EMDASH;
          const mndCell = mnd != null ? `${mnd.toFixed(2)}%` : EMDASH;
          const nwCell = nw != null ? `${nw.toFixed(2)}%` : EMDASH;

          return (
            <Fragment key={p.m}>
              <tr>
                <td>{p.m}</td>
                <td>{usCell}</td>
                <td>{ncCell}</td>
                <td>
                  <div className="rt-mnd-cell">
                    <span>{mndCell}</span>
                    {hasWeeks && (
                      <button
                        type="button"
                        className={`rt-weekly-toggle${expanded ? " is-open" : ""}`}
                        onClick={() => setExpandedMonth(expanded ? null : p.m)}
                        aria-expanded={expanded}
                        aria-label={
                          expanded
                            ? `Hide weekly breakdown for ${p.m}`
                            : `Show weekly breakdown for ${p.m}`
                        }
                        title={
                          expanded
                            ? "Hide weekly averages"
                            : `Show ${weeks.length} weekly avg${weeks.length === 1 ? "" : "s"}`
                        }
                      >
                        <span className="rt-weekly-count">{weeks.length}w</span>
                        <span className="rt-weekly-caret" aria-hidden="true">▾</span>
                      </button>
                    )}
                  </div>
                </td>
                {showNw && <td>{nwCell}</td>}
              </tr>
              {expanded && hasWeeks && (
                <tr className="rt-week-row">
                  <td colSpan={colCount}>
                    <div className="rt-week-chips">
                      {weeks.map((w) => (
                        <span key={w.weekStart} className="rt-week-chip">
                          <span className="rt-week-chip-label">{w.weekLabel}</span>
                          <span className="rt-week-chip-val">{w.avg.toFixed(2)}%</span>
                          <span className="rt-week-chip-n">{w.n}d</span>
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
