import type { ReactNode } from "react";
import { Line } from "react-chartjs-2";
import type { ChartData } from "chart.js";
import type {
  ChartPoint,
  DailyRatePoint,
  HmdaSummary,
  MonthlyRate,
  NcMonthlySnapshot,
} from "../types";
import { buildOptions } from "../chart/buildOptions";
import "../chart/registerChart";

interface Props {
  usData: MonthlyRate[];
  ncData: NcMonthlySnapshot[];
  mndData?: NcMonthlySnapshot[];
  ncDaily?: DailyRatePoint[];
  mndDaily?: DailyRatePoint[];
  timescale?: "monthly" | "weekly";
  hmdaBand?: HmdaSummary;
  title: string;
  usLabel: string;
  ncLabel: string;
  mndLabel?: string;
  yMin: number;
  yMax: number;
  stateLabel?: string;
  term?: 15 | 30;
  footerRight?: ReactNode;
}

// End-of-week (Sunday) ISO key for a given YYYY-MM-DD.
function weekEndKey(dateIso: string): string {
  const d = new Date(dateIso + "T00:00:00Z");
  const dow = d.getUTCDay(); // 0 = Sun
  const daysToSunday = (7 - dow) % 7;
  d.setUTCDate(d.getUTCDate() + daysToSunday);
  return d.toISOString().slice(0, 10);
}

function aggregateDailyToWeekly(daily: DailyRatePoint[]): NcMonthlySnapshot[] {
  // For each week (keyed by Sunday end), keep the daily row with the latest date.
  const byWeek = new Map<string, DailyRatePoint>();
  for (const d of daily) {
    if (d.rate == null) continue;
    const wk = weekEndKey(d.date);
    const prior = byWeek.get(wk);
    if (!prior || prior.date < d.date) byWeek.set(wk, d);
  }
  return Array.from(byWeek.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([wk, row]) => ({ m: wk, date: row.date, rate: row.rate, src: row.src }));
}

const NC_RED = "#c8392c";
const MND_TEAL = "#0d7a6e";

interface NcStyle {
  pointStyle: "rectRot" | "circle" | "cross" | "triangle";
  pointBackgroundColor: string;
  pointBorderColor: string;
  pointBorderWidth: number;
  pointRadius: number;
}

function styleFor(src: string): NcStyle {
  if (src.startsWith("Bankrate NC (live")) {
    return {
      pointStyle: "circle",
      pointBackgroundColor: "#fff",
      pointBorderColor: NC_RED,
      pointBorderWidth: 2.5,
      pointRadius: 5,
    };
  }
  if (src.startsWith("Experian")) {
    return {
      pointStyle: "cross",
      pointBackgroundColor: NC_RED,
      pointBorderColor: NC_RED,
      pointBorderWidth: 2,
      pointRadius: 6,
    };
  }
  return {
    pointStyle: "rectRot",
    pointBackgroundColor: NC_RED,
    pointBorderColor: NC_RED,
    pointBorderWidth: 1,
    pointRadius: 4,
  };
}

export function RateChart({
  usData,
  ncData,
  mndData,
  ncDaily,
  mndDaily,
  timescale = "monthly",
  hmdaBand,
  title,
  usLabel,
  ncLabel,
  mndLabel,
  yMin,
  yMax,
  stateLabel,
  term,
  footerRight,
}: Props) {
  const usPoints: ChartPoint[] = usData.map((p) => ({ x: `${p.month}-15`, y: p.rate }));

  // Pick the primary state-source series based on the timescale toggle.
  // Weekly is derived in-browser from the daily JSONs; monthly comes from the
  // reconciled 24-row file. If the user selects weekly but no daily data has
  // accumulated yet, fall back to the monthly series so the chart still renders.
  const ncWeekly = timescale === "weekly" && ncDaily ? aggregateDailyToWeekly(ncDaily) : null;
  const mndWeekly = timescale === "weekly" && mndDaily ? aggregateDailyToWeekly(mndDaily) : null;
  const ncSeries = ncWeekly && ncWeekly.length > 0 ? ncWeekly : ncData;
  const mndSeries = mndWeekly && mndWeekly.length > 0 ? mndWeekly : mndData;

  const ncPoints: ChartPoint[] = ncSeries.map((p) => ({ x: p.date, y: p.rate, src: p.src }));
  const ncStyles = ncSeries.map((p) => (p.rate == null ? styleFor("") : styleFor(p.src)));

  const datasets: ChartData<"line", ChartPoint[]>["datasets"] = [];
  // US PMMS is monthly resolution — only show it on the monthly view. Including
  // it on the weekly zoom would compress the weekly Bankrate/MND signal to a
  // thin sliver next to the long PMMS line.
  if (timescale === "monthly") {
    datasets.push({
      label: usLabel,
      data: usPoints,
      borderColor: "#1f5fa8",
      backgroundColor: "#1f5fa8",
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.25,
      order: 4,
    });
  }
  datasets.push({
    label: ncLabel,
    data: ncPoints,
    borderColor: NC_RED,
    backgroundColor: NC_RED,
    borderWidth: 2,
    pointStyle: ncStyles.map((s) => s.pointStyle),
    pointBackgroundColor: ncStyles.map((s) => s.pointBackgroundColor),
    pointBorderColor: ncStyles.map((s) => s.pointBorderColor),
    pointBorderWidth: ncStyles.map((s) => s.pointBorderWidth),
    pointRadius: ncStyles.map((s) => s.pointRadius),
    pointHoverRadius: 7,
    tension: 0.25,
    spanGaps: false,
    order: 3,
  });

  const mndHasAny = mndSeries && mndSeries.some((p) => p.rate != null);
  if (mndHasAny) {
    const mndPoints: ChartPoint[] = mndSeries!.map((p) => ({ x: p.date, y: p.rate, src: p.src }));
    datasets.push({
      label: mndLabel ?? "NC (Mortgage News Daily)",
      data: mndPoints,
      borderColor: MND_TEAL,
      backgroundColor: MND_TEAL,
      borderWidth: 1.5,
      borderDash: [4, 3],
      pointStyle: "triangle",
      pointRadius: 5,
      pointHoverRadius: 7,
      tension: 0.25,
      spanGaps: false,
      order: 2,
    });
  }

  // Daily trail overlay — connects the raw daily values so the user can see
  // day-to-day movement on top of whichever aggregation (monthly/weekly) is
  // showing. Drawn ABOVE the primary series so it stays visible even when
  // dates overlap. Requires at least 2 daily points; otherwise omitted.
  const ncDailyPts: ChartPoint[] =
    (ncDaily ?? [])
      .filter((d) => d.rate != null)
      .map((d) => ({ x: d.date, y: d.rate, src: `${d.src} (daily)` }));
  if (ncDailyPts.length >= 2) {
    datasets.push({
      label: `${ncLabel.replace(/\s*\(.*\)$/, "")} (daily trail)`,
      data: ncDailyPts,
      borderColor: "rgba(200, 57, 44, 0.85)",
      backgroundColor: "rgba(200, 57, 44, 0.85)",
      borderWidth: 2,
      borderDash: [3, 3],
      pointRadius: 3.5,
      pointStyle: "circle",
      pointHoverRadius: 6,
      tension: 0,
      spanGaps: true,
      order: 1,
    });
  }
  const mndDailyPts: ChartPoint[] =
    (mndDaily ?? [])
      .filter((d) => d.rate != null)
      .map((d) => ({ x: d.date, y: d.rate, src: `${d.src} (daily)` }));
  if (mndDailyPts.length >= 2) {
    datasets.push({
      label: `${mndLabel?.replace(/\s*\(.*\)$/, "") ?? "MND"} (daily trail)`,
      data: mndDailyPts,
      borderColor: "rgba(13, 122, 110, 0.85)",
      backgroundColor: "rgba(13, 122, 110, 0.85)",
      borderWidth: 2,
      borderDash: [3, 3],
      pointRadius: 3.5,
      pointStyle: "circle",
      pointHoverRadius: 6,
      tension: 0,
      spanGaps: true,
      order: 0,
    });
  }

  const data: ChartData<"line", ChartPoint[]> = { datasets };

  return (
    <>
      <div className="chartwrap">
        <Line
          data={data}
          options={buildOptions({
            title,
            yMin,
            yMax,
            hmdaBand: timescale === "monthly" ? hmdaBand : undefined,
            timescale,
          })}
        />
      </div>
      <ChartLegend
        usLabel={usLabel}
        ncLabel={ncLabel}
        mndLabel={mndLabel}
        mndHasAny={!!mndHasAny}
      />
      {(hmdaBand || footerRight) && (
        <div className="chart-footer-row">
          {hmdaBand && (
            <HmdaBandExplainer
              band={hmdaBand}
              stateLabel={stateLabel ?? "this state"}
              term={term ?? 15}
            />
          )}
          {footerRight && <div className="chart-footer-action">{footerRight}</div>}
        </div>
      )}
    </>
  );
}

function ChartLegend({
  usLabel,
  ncLabel,
  mndLabel,
  mndHasAny,
}: {
  usLabel: string;
  ncLabel: string;
  mndLabel?: string;
  mndHasAny: boolean;
}) {
  return (
    <div className="chart-legend">
      <ul className="cl-datasets">
        <li>
          <span className="cl-swatch cl-line-us" aria-hidden="true" />
          <span className="cl-label">{usLabel}</span>
        </li>
        <li>
          <span className="cl-swatch cl-line-state" aria-hidden="true" />
          <span className="cl-label">{ncLabel}</span>
        </li>
        {mndHasAny && (
          <li>
            <span className="cl-swatch cl-line-mnd" aria-hidden="true" />
            <span className="cl-label">{mndLabel ?? "Mortgage News Daily"}</span>
          </li>
        )}
      </ul>
      <div className="cl-markers-section" aria-label="Point style variants">
        {mndHasAny && (
          <div className="cl-markers-col">
            <span className="cl-marker-item">
              <span className="cl-m cl-m-triangle" aria-hidden="true" /> daily
            </span>
          </div>
        )}
        <div className="cl-markers-col">
          <span className="cl-marker-item">
            <span className="cl-m cl-m-diamond" aria-hidden="true" /> Wayback
          </span>
          <span className="cl-marker-item">
            <span className="cl-m cl-m-circle" aria-hidden="true" /> live
          </span>
          <span className="cl-marker-item">
            <span className="cl-m cl-m-cross" aria-hidden="true" /> Experian
          </span>
        </div>
      </div>
    </div>
  );
}

function HmdaBandExplainer({
  band,
  stateLabel,
  term,
}: {
  band: HmdaSummary;
  stateLabel: string;
  term: 15 | 30;
}) {
  return (
    <details className="hmda-explainer">
      <summary>
        <span className="hmda-explainer-swatch" aria-hidden="true" />
        What's the green band?
      </summary>
      <div className="hmda-explainer-body">
        <p>
          The green region shows the actual rates closed loans got in {stateLabel} during 2024
          ({band.n_loans.toLocaleString()} {term}-yr home-purchase originations, from{" "}
          <a href="https://ffiec.cfpb.gov/data-browser/" target="_blank" rel="noopener noreferrer">
            FFIEC HMDA
          </a>
          ). It anchors today's quoted rates against last year's real-world distribution. HMDA has no
          monthly resolution, so the band is positioned over the 2024 calendar year only.
        </p>
        <ul className="hmda-explainer-list">
          <li>
            <span className="hmda-sw hmda-sw-outer" aria-hidden="true" />
            <span>
              <b>Outer pale box</b> — middle 80% of rates (p10–p90):{" "}
              <span className="mono">
                {band.p10_pct.toFixed(2)}%–{band.p90_pct.toFixed(2)}%
              </span>
            </span>
          </li>
          <li>
            <span className="hmda-sw hmda-sw-inner" aria-hidden="true" />
            <span>
              <b>Inner darker box</b> — middle 50% of rates (p25–p75):{" "}
              <span className="mono">
                {band.p25_pct.toFixed(2)}%–{band.p75_pct.toFixed(2)}%
              </span>
            </span>
          </li>
          <li>
            <span className="hmda-sw hmda-sw-line-long" aria-hidden="true" />
            <span>
              <b>Long-dash line</b> — simple mean rate:{" "}
              <span className="mono">{band.simple_mean_pct.toFixed(2)}%</span>
            </span>
          </li>
          <li>
            <span className="hmda-sw hmda-sw-line-short" aria-hidden="true" />
            <span>
              <b>Short-dash line</b> — amount-weighted mean (weighted by loan size):{" "}
              <span className="mono">{band.amount_weighted_mean_pct.toFixed(2)}%</span>
            </span>
          </li>
        </ul>
        <p className="hmda-explainer-foot">
          If today's quoted line sits near the bottom of the band, you're in the better-than-typical
          half of 2024 closings; near the top, the worse-than-typical half.
        </p>
      </div>
    </details>
  );
}
