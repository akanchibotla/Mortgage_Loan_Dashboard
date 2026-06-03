import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  Tooltip,
  Legend,
  Title,
  Filler,
} from "chart.js";
import "chartjs-adapter-date-fns";
import annotationPlugin from "chartjs-plugin-annotation";
import { crosshairPlugin } from "./crosshairPlugin";

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  Tooltip,
  Legend,
  Title,
  Filler,
  annotationPlugin,
  crosshairPlugin,
);

// Snap radius for cursor → point gravity. With interaction.intersect: true
// (set in buildOptions), the tooltip activates iff the cursor is inside a
// point's hitRadius. 15px keeps "free cursor" the dominant mode at our
// chart densities (~5 datasets × ~25 monthly points = ~125 hit regions
// over a ~1100×400 plot) while still being a comfortable target — a
// noticeably larger radius (e.g. 25px) made nearly the whole chart
// snap-active and the cursor never read as free.
Chart.defaults.elements.point.hitRadius = 15;
