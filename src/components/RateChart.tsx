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
import { useChartToggles, type ChartSourceId } from "../lib/useChartToggles";
import "../chart/registerChart";

interface Props {
  usData: MonthlyRate[];
  ncData: NcMonthlySnapshot[];
  mndData?: NcMonthlySnapshot[];
  nwData?: NcMonthlySnapshot[];
  ncDaily?: DailyRatePoint[];
  mndDaily?: DailyRatePoint[];
  timescale?: "monthly" | "weekly";
  hmdaBand?: HmdaSummary;
  title: string;
  usLabel: string;
  ncLabel: string;
  mndLabel?: string;
  nwLabel?: string;
  yMin: number;
  yMax: number;
  stateLabel?: string;
  term?: 15 | 30;
  footerRight?: ReactNode;
}

const NC_RED = "#c8392c";
const MND_TEAL = "#0d7a6e";
const NW_PURPLE = "#7c3aed";

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

// NerdWallet's data shape mirrors Bankrate's (live = today; everything else
// from Wayback), so its markers follow the same convention — hollow circle
// for the latest live reading, diamond for a historical Wayback reading —
// just rendered in NW's purple instead of NC's red.
function styleForNw(src: string): NcStyle {
  if (src.startsWith("NerdWallet (Wayback)")) {
    return {
      pointStyle: "rectRot",
      pointBackgroundColor: NW_PURPLE,
      pointBorderColor: NW_PURPLE,
      pointBorderWidth: 1,
      pointRadius: 4,
    };
  }
  return {
    pointStyle: "circle",
    pointBackgroundColor: "#fff",
    pointBorderColor: NW_PURPLE,
    pointBorderWidth: 2.5,
    pointRadius: 5,
  };
}

export function RateChart({
  usData,
  ncData,
  mndData,
  nwData,
  ncDaily,
  mndDaily,
  timescale = "monthly",
  hmdaBand,
  title,
  usLabel,
  ncLabel,
  mndLabel,
  nwLabel,
  yMin,
  yMax,
  stateLabel,
  term,
  footerRight,
}: Props) {
  const usPoints: ChartPoint[] = usData.map((p) => ({ x: `${p.month}-15`, y: p.rate }));

  // Both Monthly and Weekly share the same primary series (the reconciled
  // monthly file). Weekly differs only in x-axis tick granularity; this way
  // every historical Wayback reading is visible on Weekly too, instead of
  // being clipped by a narrow recent-window view.
  const ncSeries = ncData;
  const mndSeries = mndData;

  // Date range covered by the daily-trail datasets. When a monthly-aggregate
  // point falls inside this range its marker is suppressed on the Monthly
  // view, because the daily trail already represents that reading (and the
  // trail's own "only the latest gets a marker" rule then handles the
  // visual cluster cleanly). Weekly view keeps every monthly marker visible
  // since on that scale the marker is the anchor among the daily noise.
  const ncDailyValid = (ncDaily ?? []).filter((d) => d.rate != null);
  const mndDailyValid = (mndDaily ?? []).filter((d) => d.rate != null);
  const ncDailyRange: [string, string] | null =
    ncDailyValid.length >= 2
      ? [ncDailyValid[0].date, ncDailyValid[ncDailyValid.length - 1].date]
      : null;
  const mndDailyRange: [string, string] | null =
    mndDailyValid.length >= 2
      ? [mndDailyValid[0].date, mndDailyValid[mndDailyValid.length - 1].date]
      : null;
  const inMonthlySuppressRange = (
    date: string,
    range: [string, string] | null,
  ): boolean =>
    timescale === "monthly" && range !== null && date >= range[0] && date <= range[1];

  const ncPoints: ChartPoint[] = ncSeries.map((p) => ({ x: p.date, y: p.rate, src: p.src }));
  const ncStyles = ncSeries.map((p) => {
    const base = p.rate == null ? styleFor("") : styleFor(p.src);
    if (p.rate != null && inMonthlySuppressRange(p.date, ncDailyRange)) {
      return { ...base, pointRadius: 0 };
    }
    return base;
  });

  const { isVisible, visibleSet, toggle } = useChartToggles();
  const datasets: ChartData<"line", ChartPoint[]>["datasets"] = [];
  // Track each dataset's source ID so the legend can show what's toggled
  // and the chart can hide datasets without re-ordering the array.
  const sourceIds: ChartSourceId[] = [];
  const pushDataset = (
    sid: ChartSourceId,
    ds: ChartData<"line", ChartPoint[]>["datasets"][number],
  ) => {
    sourceIds.push(sid);
    datasets.push({ ...ds, hidden: !isVisible(sid) });
  };
  pushDataset("pmms", {
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
  pushDataset("bankrate", {
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

  // Trail/MND rendering rule on Monthly: each daily reading either belongs
  // to a "close cluster" (a neighbor within MAX_TRAIL_GAP_DAYS) or is
  // isolated. Close-cluster points get the dashed slope line drawn through
  // them with NO markers (so the user sees movement, not noise). Isolated
  // readings get their own marker and NO line (a line across multi-week
  // gaps would fake a slope that doesn't really exist).
  // On Weekly, every marker stays visible since the trail is the primary
  // signal.
  const MAX_TRAIL_GAP_DAYS = 4;
  const daysBetween = (a: string, b: string): number =>
    (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24);

  type TrailPoint = ChartPoint | { x: string; y: null };
  const withGapBreaks = (pts: ChartPoint[]): TrailPoint[] => {
    const out: TrailPoint[] = [];
    for (let i = 0; i < pts.length; i++) {
      out.push(pts[i]);
      if (i < pts.length - 1) {
        const gap = daysBetween(pts[i].x as string, pts[i + 1].x as string);
        if (gap > MAX_TRAIL_GAP_DAYS) {
          const midMs = (
            new Date(pts[i].x as string).getTime() +
            new Date(pts[i + 1].x as string).getTime()
          ) / 2;
          out.push({ x: new Date(midMs).toISOString().slice(0, 10), y: null });
        }
      }
    }
    return out;
  };

  // A point is "isolated" iff neither neighbor is within the gap window.
  const isolationOf = (pts: ChartPoint[]): boolean[] =>
    pts.map((_, i) => {
      const leftClose =
        i > 0 && daysBetween(pts[i - 1].x as string, pts[i].x as string) <= MAX_TRAIL_GAP_DAYS;
      const rightClose =
        i < pts.length - 1 &&
        daysBetween(pts[i].x as string, pts[i + 1].x as string) <= MAX_TRAIL_GAP_DAYS;
      return !leftClose && !rightClose;
    });

  // The pointRadius array must be indexed by position in the final
  // (gap-injected) data array. Original-point indices map to their new
  // positions one-to-one in order; injected nulls render at radius 0.
  const radiusArray = (
    final: TrailPoint[],
    radiusForOriginal: (origIdx: number) => number,
  ): number[] => {
    const out: number[] = [];
    let origIdx = 0;
    for (const p of final) {
      if (p.y === null) {
        out.push(0);
      } else {
        out.push(radiusForOriginal(origIdx));
        origIdx++;
      }
    }
    return out;
  };

  const mndHasAny = mndSeries && mndSeries.some((p) => p.rate != null);
  if (mndHasAny) {
    const mndPointsRaw: ChartPoint[] = mndSeries!
      .filter((p) => p.rate != null)
      .map((p) => ({ x: p.date, y: p.rate, src: p.src }));
    const data = withGapBreaks(mndPointsRaw);
    const isolated = isolationOf(mndPointsRaw);
    const lastIdx = mndPointsRaw.length - 1;
    // Latest reading always gets a marker (acts as the "current value"
    // indicator), even when it's part of a close cluster — UNLESS the
    // daily trail already covers this date, in which case the trail's
    // own latest marker is the canonical "current" indicator.
    const showMonthlyMarker = (i: number) => {
      if (inMonthlySuppressRange(mndPointsRaw[i].x as string, mndDailyRange)) {
        return false;
      }
      return isolated[i] || i === lastIdx;
    };
    pushDataset("mnd", {
      label: mndLabel ?? "NC (Mortgage News Daily)",
      data,
      borderColor: MND_TEAL,
      backgroundColor: MND_TEAL,
      borderWidth: 1.5,
      borderDash: [4, 3],
      pointStyle: "triangle",
      pointRadius: radiusArray(data, (i) =>
        timescale === "monthly" ? (showMonthlyMarker(i) ? 6 : 0) : 5,
      ),
      pointHoverRadius: radiusArray(data, (i) =>
        timescale === "monthly" ? (showMonthlyMarker(i) ? 8 : 0) : 7,
      ),
      tension: 0.25,
      spanGaps: false,
      order: 2,
    });
  }

  // NerdWallet monthly series (state-average note rate). Same data shape
  // as Bankrate — Wayback historical rows plus a single live trailing row —
  // so we use the same per-point marker pattern (diamond for Wayback, hollow
  // circle for live), recolored purple for source separation.
  const nwHasAny = nwData && nwData.some((p) => p.rate != null);
  if (nwHasAny) {
    const nwSeries = nwData!;
    const nwPoints: ChartPoint[] = nwSeries.map((p) => ({
      x: p.date, y: p.rate, src: p.src,
    }));
    const nwStyles = nwSeries.map((p) => (p.rate == null ? styleForNw("") : styleForNw(p.src)));
    pushDataset("nerdwallet", {
      label: nwLabel ?? "NerdWallet (state average)",
      data: nwPoints,
      borderColor: NW_PURPLE,
      backgroundColor: NW_PURPLE,
      borderWidth: 2,
      pointStyle: nwStyles.map((s) => s.pointStyle),
      pointBackgroundColor: nwStyles.map((s) => s.pointBackgroundColor),
      pointBorderColor: nwStyles.map((s) => s.pointBorderColor),
      pointBorderWidth: nwStyles.map((s) => s.pointBorderWidth),
      pointRadius: nwStyles.map((s) => s.pointRadius),
      pointHoverRadius: 7,
      tension: 0.25,
      spanGaps: false,
      order: 2,
    });
  }

  // Daily trail rule: trail is the recent slope leading up to NOW. Render
  // previous days as just the dashed line (no markers) and reserve the
  // marker for the LATEST point as the "current value" indicator. Weekly
  // shows every daily marker since the trail IS the zoom-in signal.
  const ncDailyPts: ChartPoint[] =
    (ncDaily ?? [])
      .filter((d) => d.rate != null)
      .map((d) => ({ x: d.date, y: d.rate, src: `${d.src} (daily)` }));
  if (ncDailyPts.length >= 2) {
    const data = withGapBreaks(ncDailyPts);
    const lastIdx = ncDailyPts.length - 1;
    pushDataset("bankrate", {
      label: `${ncLabel.replace(/\s*\(.*\)$/, "")} (daily trail)`,
      data,
      borderColor: "rgba(200, 57, 44, 0.85)",
      backgroundColor: "rgba(200, 57, 44, 0.85)",
      borderWidth: 2,
      borderDash: [3, 3],
      pointRadius: radiusArray(data, (i) =>
        timescale === "monthly" ? (i === lastIdx ? 4.5 : 0) : 3.5,
      ),
      pointStyle: "circle",
      pointHoverRadius: radiusArray(data, (i) =>
        timescale === "monthly" ? (i === lastIdx ? 7 : 0) : 6,
      ),
      tension: 0,
      spanGaps: false,
      order: 1,
    });
  }
  const mndDailyPts: ChartPoint[] =
    (mndDaily ?? [])
      .filter((d) => d.rate != null)
      .map((d) => ({ x: d.date, y: d.rate, src: `${d.src} (daily)` }));
  if (mndDailyPts.length >= 2) {
    const data = withGapBreaks(mndDailyPts);
    const lastIdx = mndDailyPts.length - 1;
    pushDataset("mnd", {
      label: `${mndLabel?.replace(/\s*\(.*\)$/, "") ?? "MND"} (daily trail)`,
      data,
      borderColor: "rgba(13, 122, 110, 0.85)",
      backgroundColor: "rgba(13, 122, 110, 0.85)",
      borderWidth: 2,
      borderDash: [3, 3],
      pointRadius: radiusArray(data, (i) =>
        timescale === "monthly" ? (i === lastIdx ? 4.5 : 0) : 3.5,
      ),
      pointStyle: "circle",
      pointHoverRadius: radiusArray(data, (i) =>
        timescale === "monthly" ? (i === lastIdx ? 7 : 0) : 6,
      ),
      tension: 0,
      spanGaps: false,
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
            hmdaBand:
              timescale === "monthly" && isVisible("hmda") ? hmdaBand : undefined,
            timescale,
          })}
        />
      </div>
      <ChartLegend
        usLabel={usLabel}
        ncLabel={ncLabel}
        mndLabel={mndLabel}
        nwLabel={nwLabel}
        mndHasAny={!!mndHasAny}
        nwHasAny={!!nwHasAny}
        hasHmda={!!hmdaBand && timescale === "monthly"}
        hasExperian={ncSeries.some((p) => (p.src ?? "").startsWith("Experian"))}
        hasDailyTrail={ncDailyValid.length >= 2 || mndDailyValid.length >= 2}
        visibleSet={visibleSet}
        onToggle={toggle}
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
  nwLabel,
  mndHasAny,
  nwHasAny,
  hasHmda,
  hasExperian,
  hasDailyTrail,
  visibleSet,
  onToggle,
}: {
  usLabel: string;
  ncLabel: string;
  mndLabel?: string;
  nwLabel?: string;
  mndHasAny: boolean;
  nwHasAny: boolean;
  hasHmda: boolean;
  hasExperian: boolean;
  hasDailyTrail: boolean;
  visibleSet: Set<ChartSourceId>;
  onToggle: (id: ChartSourceId) => void;
}) {
  const renderRow = (
    id: ChartSourceId,
    swatchClass: string,
    label: string,
  ) => {
    const on = visibleSet.has(id);
    return (
      <li>
        <button
          type="button"
          className={`cl-toggle${on ? "" : " off"}`}
          onClick={() => onToggle(id)}
          aria-pressed={on}
          aria-label={`${on ? "Hide" : "Show"} ${label}`}
        >
          <span className={`cl-swatch ${swatchClass}`} aria-hidden="true" />
          <span className="cl-label">{label}</span>
        </button>
      </li>
    );
  };
  return (
    <div className="chart-legend">
      <ul className="cl-datasets">
        {renderRow("pmms", "cl-line-us", usLabel)}
        {renderRow("bankrate", "cl-line-state", ncLabel)}
        {mndHasAny &&
          renderRow("mnd", "cl-line-mnd", mndLabel ?? "Mortgage News Daily")}
        {nwHasAny &&
          renderRow("nerdwallet", "cl-line-nw", nwLabel ?? "NerdWallet (state average)")}
        {hasHmda &&
          renderRow("hmda", "cl-swatch-hmda", "HMDA 2024 reference band")}
      </ul>
      <div className="cl-markers-section" aria-label="Point style variants">
        {/* Right column — per-source markers (one shape per dataset). */}
        <div className="cl-markers-col">
          <span className="cl-marker-item">
            <span className="cl-m cl-m-pmms-dot" aria-hidden="true" /> PMMS monthly
          </span>
          {mndHasAny && (
            <span className="cl-marker-item">
              <span className="cl-m cl-m-triangle" aria-hidden="true" /> MND monthly
            </span>
          )}
          {hasDailyTrail && (
            <span className="cl-marker-item">
              <span className="cl-m cl-m-trail-dot" aria-hidden="true" /> daily-trail latest
            </span>
          )}
        </div>
        {/* Left column — shape variants that apply across multiple sources.
            Wayback / live shapes appear in Bankrate-red and (when present)
            NerdWallet-purple; only the red swatch is shown to keep the
            legend compact. */}
        <div className="cl-markers-col">
          <span className="cl-marker-item">
            <span className="cl-m cl-m-diamond" aria-hidden="true" /> Wayback (archive)
          </span>
          <span className="cl-marker-item">
            <span className="cl-m cl-m-circle" aria-hidden="true" /> live (today)
          </span>
          {hasExperian && (
            <span className="cl-marker-item">
              <span className="cl-m cl-m-cross" aria-hidden="true" /> Experian (NC only)
            </span>
          )}
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
