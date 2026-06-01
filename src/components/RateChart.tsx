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
      <ul className="marker-legend">
        <li>
          <span className="m m-diamond" /> Bankrate Wayback (archived month)
        </li>
        <li>
          <span className="m m-circle" /> Bankrate live (latest)
        </li>
        <li>
          <span className="m m-cross" /> Experian fallback
        </li>
        {mndHasAny && (
          <li>
            <span className="m m-triangle" /> Mortgage News Daily (Wayback + live)
          </li>
        )}
      </ul>
    </>
  );
}
