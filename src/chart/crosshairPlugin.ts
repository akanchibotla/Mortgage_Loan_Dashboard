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
  cursorX: number | null;
  cursorY: number | null;
}

const STATE_KEY = "__crosshairState" as const;
const stateOf = (chart: unknown): CursorState => {
  const c = chart as { [STATE_KEY]?: CursorState };
  if (!c[STATE_KEY]) c[STATE_KEY] = { cursorX: null, cursorY: null };
  return c[STATE_KEY]!;
};

const inChartArea = (
  x: number,
  y: number,
  area: { left: number; right: number; top: number; bottom: number },
): boolean => x >= area.left && x <= area.right && y >= area.top && y <= area.bottom;

export const crosshairPlugin: Plugin<"line"> = {
  id: "crosshair",

  afterEvent(chart, args) {
    const state = stateOf(chart);
    const e = args.event;
    // Chart.js v4 narrows `event.type` to only "click" / "mouseout" / etc. —
    // mousemove + touchmove come through via the wrapped native event.
    const nativeType = (e.native as Event | null)?.type;
    if (nativeType === "mousemove" || nativeType === "touchmove") {
      state.cursorX = e.x ?? null;
      state.cursorY = e.y ?? null;
      // Force a redraw on every move so the free-cursor crosshair tracks
      // 1:1 even when no point is in range (without changed=true Chart.js
      // would skip the redraw when the tooltip stays inactive).
      args.changed = true;
    } else if (nativeType === "mouseout" || e.type === "mouseout") {
      state.cursorX = null;
      state.cursorY = null;
      args.changed = true;
    }
  },

  afterDatasetsDraw(chart) {
    const state = stateOf(chart);
    if (state.cursorX == null || state.cursorY == null) return;
    const { chartArea } = chart;
    if (!inChartArea(state.cursorX, state.cursorY, chartArea)) return;

    const tooltip = chart.tooltip;
    const active = tooltip?.getActiveElements?.() ?? [];

    let xPx: number;
    let yPx: number;
    if (active.length > 0) {
      // Snapped to a data point. The vertical line locks to the snapped
      // X (time slice). The horizontal line locks to whichever active
      // dataset's point is closest to the cursor's Y — so sliding the
      // cursor up to PMMS pins the horizontal anchor on PMMS, down to
      // NerdWallet pins it on NW.
      xPx = (active[0].element as unknown as { x: number }).x;
      yPx = (active[0].element as unknown as { y: number }).y;
      let bestDist = Math.abs(yPx - state.cursorY);
      for (let i = 1; i < active.length; i++) {
        const candidate = (active[i].element as unknown as { y: number }).y;
        const d = Math.abs(candidate - state.cursorY);
        if (d < bestDist) {
          bestDist = d;
          yPx = candidate;
        }
      }
    } else {
      // Free cursor — no point is in snap range. Crosshair tracks the
      // raw cursor; no tooltip shows.
      xPx = state.cursorX;
      yPx = state.cursorY;
    }

    const { ctx } = chart;
    ctx.save();
    ctx.strokeStyle = "rgba(74, 85, 104, 0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);

    // Vertical line through the snap/cursor X, edge-to-edge
    ctx.beginPath();
    ctx.moveTo(xPx, chartArea.top);
    ctx.lineTo(xPx, chartArea.bottom);
    ctx.stroke();

    // Horizontal line through the snap/cursor Y, edge-to-edge
    ctx.beginPath();
    ctx.moveTo(chartArea.left, yPx);
    ctx.lineTo(chartArea.right, yPx);
    ctx.stroke();

    ctx.restore();
  },
};
