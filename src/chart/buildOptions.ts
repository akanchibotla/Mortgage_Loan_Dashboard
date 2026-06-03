import type { ChartOptions, TooltipItem } from "chart.js";
import type { ChartPoint, HmdaSummary } from "../types";
import windowConfig from "../data/window.json";

const W = windowConfig as { from: string; to: string; n_months: number };

interface BuildOptionsArgs {
  title: string;
  yMin: number;
  yMax: number;
  hmdaBand?: HmdaSummary;
  timescale?: "monthly" | "weekly";
  weeklyDays?: number; // window size when zoomed to weekly view; default 182 (~26 weeks)
}

export function buildOptions({
  title,
  yMin,
  yMax,
  hmdaBand,
  timescale = "monthly",
  weeklyDays = 182,
}: BuildOptionsArgs): ChartOptions<"line"> {
  let xMin: string = W.from;
  let xMax: string = W.to;
  let xUnit: "month" | "week" | "day" = "month";
  let xLabel = "Month";
  if (timescale === "weekly") {
    const today = new Date();
    const past = new Date(today.getTime() - weeklyDays * 24 * 60 * 60 * 1000);
    xMin = past.toISOString().slice(0, 10);
    xMax = today.toISOString().slice(0, 10);
    xUnit = "week";
    xLabel = "Week";
  }
  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "nearest", intersect: false },
    scales: {
      x: {
        type: "time",
        time: {
          unit: xUnit,
          displayFormats: {
            month: "MMM yyyy",
            week: "MMM d",
            day: "MMM d",
          },
          tooltipFormat: "MMM d, yyyy",
        },
        min: xMin,
        max: xMax,
        title: { display: true, text: xLabel },
        ticks: { maxRotation: 45, minRotation: 45 },
      },
      y: {
        title: { display: true, text: "Rate (%)" },
        suggestedMin: yMin,
        suggestedMax: yMax,
        ticks: { callback: (v) => `${Number(v).toFixed(2)}%` },
      },
    },
    plugins: {
      title: { display: true, text: title },
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (item: TooltipItem<"line">) => {
            const p = item.raw as ChartPoint;
            const valueLine = `${item.dataset.label}: ${p.y == null ? "(no data)" : `${p.y.toFixed(3)}%`}`;
            return p.src ? [valueLine, `source: ${p.src}`] : valueLine;
          },
        },
      },
    },
  };

  if (hmdaBand && options.plugins) {
    options.plugins.annotation = {
      annotations: {
        hmdaP10P90: {
          type: "box",
          xMin: "2024-01-01",
          xMax: "2024-12-31",
          yMin: hmdaBand.p10_pct,
          yMax: hmdaBand.p90_pct,
          backgroundColor: "rgba(46, 139, 87, 0.07)",
          borderColor: "rgba(46, 139, 87, 0.35)",
          borderWidth: 1,
        },
        hmdaP25P75: {
          type: "box",
          xMin: "2024-01-01",
          xMax: "2024-12-31",
          yMin: hmdaBand.p25_pct,
          yMax: hmdaBand.p75_pct,
          backgroundColor: "rgba(46, 139, 87, 0.14)",
          borderColor: "rgba(46, 139, 87, 0.5)",
          borderWidth: 1,
        },
        hmdaSimpleLine: {
          type: "line",
          xMin: "2024-01-01",
          xMax: "2024-12-31",
          yMin: hmdaBand.simple_mean_pct,
          yMax: hmdaBand.simple_mean_pct,
          borderColor: "rgba(46, 139, 87, 0.85)",
          borderWidth: 1.5,
          borderDash: [6, 4],
        },
        hmdaWeightedLine: {
          type: "line",
          xMin: "2024-01-01",
          xMax: "2024-12-31",
          yMin: hmdaBand.amount_weighted_mean_pct,
          yMax: hmdaBand.amount_weighted_mean_pct,
          borderColor: "rgba(46, 139, 87, 0.85)",
          borderWidth: 1.5,
          borderDash: [2, 4],
        },
      },
    };
  }

  return options;
}
