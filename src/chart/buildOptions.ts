import type { ChartOptions, TooltipItem } from "chart.js";
import type { ChartPoint, HmdaSummary } from "../types";
import windowConfig from "../data/window.json";

const W = windowConfig as { from: string; to: string; n_months: number };

interface BuildOptionsArgs {
  title: string;
  yMin: number;
  yMax: number;
  hmdaBand?: HmdaSummary;
}

export function buildOptions({ title, yMin, yMax, hmdaBand }: BuildOptionsArgs): ChartOptions<"line"> {
  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "nearest", intersect: false },
    scales: {
      x: {
        type: "time",
        time: {
          unit: "month",
          displayFormats: { month: "MMM yyyy" },
          tooltipFormat: "MMM d, yyyy",
        },
        min: W.from,
        max: W.to,
        title: { display: true, text: "Month" },
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
      legend: { position: "bottom" },
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
