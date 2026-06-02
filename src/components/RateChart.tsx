import { Line } from "react-chartjs-2";
import type { ChartData } from "chart.js";
import type {
  ChartPoint,
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
  hmdaBand?: HmdaSummary;
  title: string;
  usLabel: string;
  ncLabel: string;
  mndLabel?: string;
  yMin: number;
  yMax: number;
  stateLabel?: string;
  term?: 15 | 30;
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
  hmdaBand,
  title,
  usLabel,
  ncLabel,
  mndLabel,
  yMin,
  yMax,
  stateLabel,
  term,
}: Props) {
  const usPoints: ChartPoint[] = usData.map((p) => ({ x: `${p.month}-15`, y: p.rate }));
  const ncPoints: ChartPoint[] = ncData.map((p) => ({ x: p.date, y: p.rate, src: p.src }));

  const ncStyles = ncData.map((p) => (p.rate == null ? styleFor("") : styleFor(p.src)));

  const datasets: ChartData<"line", ChartPoint[]>["datasets"] = [
    {
      label: usLabel,
      data: usPoints,
      borderColor: "#1f5fa8",
      backgroundColor: "#1f5fa8",
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.25,
      order: 3,
    },
    {
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
      order: 2,
    },
  ];

  const mndHasAny = mndData && mndData.some((p) => p.rate != null);
  if (mndHasAny) {
    const mndPoints: ChartPoint[] = mndData!.map((p) => ({ x: p.date, y: p.rate, src: p.src }));
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
      order: 1,
    });
  }

  const data: ChartData<"line", ChartPoint[]> = { datasets };

  return (
    <>
      <div className="chartwrap">
        <Line data={data} options={buildOptions({ title, yMin, yMax, hmdaBand })} />
      </div>
      <ChartLegend
        usLabel={usLabel}
        ncLabel={ncLabel}
        mndLabel={mndLabel}
        mndHasAny={!!mndHasAny}
      />
      {hmdaBand && (
        <HmdaBandExplainer
          band={hmdaBand}
          stateLabel={stateLabel ?? "this state"}
          term={term ?? 15}
        />
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
    <ul className="chart-legend">
      <li>
        <span className="cl-swatch cl-line-us" aria-hidden="true" />
        <span className="cl-label">{usLabel}</span>
      </li>
      <li>
        <span className="cl-swatch cl-line-state" aria-hidden="true" />
        <span className="cl-label">{ncLabel}</span>
        <span className="cl-markers">
          <span className="cl-marker-item">
            <span className="cl-m cl-m-diamond" aria-hidden="true" /> Wayback
          </span>
          <span className="cl-marker-item">
            <span className="cl-m cl-m-circle" aria-hidden="true" /> live
          </span>
          <span className="cl-marker-item">
            <span className="cl-m cl-m-cross" aria-hidden="true" /> Experian
          </span>
        </span>
      </li>
      {mndHasAny && (
        <li>
          <span className="cl-swatch cl-line-mnd" aria-hidden="true" />
          <span className="cl-label">{mndLabel ?? "Mortgage News Daily"}</span>
          <span className="cl-markers">
            <span className="cl-marker-item">
              <span className="cl-m cl-m-triangle" aria-hidden="true" /> daily
            </span>
          </span>
        </li>
      )}
    </ul>
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
