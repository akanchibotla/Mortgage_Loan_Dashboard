/**
 * Crosshair + magnetic-snap plugin for the rate chart.
 *
 * Draws a vertical + horizontal dashed line through the currently-active
 * tooltip item. The "magnetic snap" comes for free from Chart.js's existing
 * `interaction: { mode: "nearest", intersect: false }` config — the tooltip
 * already attaches itself to the nearest data point as the cursor moves,
 * so by anchoring our crosshair to the tooltip's active item the lines
 * track the snap.
 *
 * Vertical line: drawn at the snapped X (time slice).
 * Horizontal line: drawn at the Y of the active dataset whose point is
 *   closest to the cursor's vertical position — so when you hover roughly
 *   over the Bankrate line the horizontal anchor reads off Bankrate, and
 *   when you slide toward the NerdWallet curve it snaps to that.
 *
 * Plugin draws nothing while the tooltip is inactive (cursor outside the
 * chart, or before the first move).
 */
import type { Plugin } from "chart.js";

interface CursorState {
  cursorY: number | null;
}

const STATE_KEY = "__crosshairState" as const;
const stateOf = (chart: unknown): CursorState => {
  const c = chart as { [STATE_KEY]?: CursorState };
  if (!c[STATE_KEY]) c[STATE_KEY] = { cursorY: null };
  return c[STATE_KEY]!;
};

export const crosshairPlugin: Plugin<"line"> = {
  id: "crosshair",

  afterEvent(chart, args) {
    const state = stateOf(chart);
    const e = args.event;
    // Chart.js v4 narrows `event.type` to only "click" / "mouseout" / etc. —
    // mousemove + touchmove come through via the wrapped native event.
    const nativeType = (e.native as Event | null)?.type;
    if (nativeType === "mousemove" || nativeType === "touchmove") {
      state.cursorY = e.y ?? null;
      args.changed = true;
    } else if (nativeType === "mouseout" || e.type === "mouseout") {
      state.cursorY = null;
      args.changed = true;
    }
  },

  afterDatasetsDraw(chart) {
    const tooltip = chart.tooltip;
    if (!tooltip) return;
    const active = tooltip.getActiveElements?.() ?? [];
    if (active.length === 0) return;

    // Snap X to the time slice the tooltip locked onto.
    const xPx = (active[0].element as unknown as { x: number }).x;

    // Snap Y to whichever active dataset's point is closest to the cursor.
    // If we have no cursor position yet (touch first frame, etc.) just use
    // the first item — same result as Chart.js's own tooltip caret pick.
    const state = stateOf(chart);
    let yPx = (active[0].element as unknown as { y: number }).y;
    if (state.cursorY != null) {
      let bestDist = Math.abs(yPx - state.cursorY);
      for (let i = 1; i < active.length; i++) {
        const candidate = (active[i].element as unknown as { y: number }).y;
        const d = Math.abs(candidate - state.cursorY);
        if (d < bestDist) {
          bestDist = d;
          yPx = candidate;
        }
      }
    }

    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.strokeStyle = "rgba(74, 85, 104, 0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);

    // Vertical line — snapped X across the full plot height
    ctx.beginPath();
    ctx.moveTo(xPx, chartArea.top);
    ctx.lineTo(xPx, chartArea.bottom);
    ctx.stroke();

    // Horizontal line — snapped Y across the full plot width
    ctx.beginPath();
    ctx.moveTo(chartArea.left, yPx);
    ctx.lineTo(chartArea.right, yPx);
    ctx.stroke();

    ctx.restore();
  },
};
