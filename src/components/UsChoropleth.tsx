import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import statesTopo from "us-atlas/states-10m.json";
import type { Topology, GeometryCollection } from "topojson-specification";

interface IndexEntry {
  slug: string;
  postal: string;
  fips: string;
  name: string;
  latest_15: number | null;
  latest_15_month: string | null;
  latest_30: number | null;
  latest_30_month: string | null;
  has_hmda_band: boolean;
  has_counties?: boolean;
  n_counties?: number;
  n_loans_hmda?: number;
  live_trailing: boolean;
}

interface Props {
  index: IndexEntry[];
  term: 15 | 30;
}

const WIDTH = 975;
const HEIGHT = 610;
const TIP_W = 250;
const TIP_H = 200;

function colorFor(rate: number | null, minR: number, maxR: number): string {
  if (rate == null) return "#e8e8e8";
  const t = Math.max(0, Math.min(1, (rate - minR) / (maxR - minR)));
  const hue = 130 - 130 * t;
  return `hsl(${hue}, 65%, 55%)`;
}

interface Hovered {
  entry: IndexEntry;
  x: number;
  y: number;
}

export function UsChoropleth({ index, term }: Props) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<Hovered | null>(null);

  const byFips = useMemo(() => {
    const m = new Map<string, IndexEntry>();
    for (const s of index) m.set(s.fips, s);
    return m;
  }, [index]);

  const filledRates = index
    .map((s) => (term === 15 ? s.latest_15 : s.latest_30))
    .filter((r): r is number => r != null);
  const minR = filledRates.length ? Math.min(...filledRates) - 0.1 : 5.0;
  const maxR = filledRates.length ? Math.max(...filledRates) + 0.1 : 7.5;

  const features = useMemo(() => {
    const topo = statesTopo as unknown as Topology<{ states: GeometryCollection }>;
    const fc = feature(topo, topo.objects.states) as unknown as FeatureCollection<
      Geometry,
      { name: string }
    >;
    return fc.features;
  }, []);

  const projection = useMemo(
    () => geoAlbersUsa().scale(1280).translate([WIDTH / 2, HEIGHT / 2]),
    [],
  );
  const pathFn = useMemo(() => geoPath(projection), [projection]);

  return (
    <div className="map-wrap">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="us-choropleth"
        preserveAspectRatio="xMidYMid meet"
      >
        {features.map((f: Feature<Geometry, { name: string }>) => {
          const fips = String(f.id).padStart(2, "0");
          const entry = byFips.get(fips);
          const rate = entry ? (term === 15 ? entry.latest_15 : entry.latest_30) : null;
          const d = pathFn(f) ?? "";
          return (
            <path
              key={fips}
              d={d}
              fill={colorFor(rate, minR, maxR)}
              stroke="#fff"
              strokeWidth={0.5}
              style={{ cursor: entry ? "pointer" : "default", transition: "fill 0.15s" }}
              onMouseEnter={(e) => entry && setHovered({ entry, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => entry && setHovered({ entry, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHovered(null)}
              onClick={() => entry && navigate(`/state/${entry.slug}`)}
            />
          );
        })}
      </svg>
      <ColorLegend minR={minR} maxR={maxR} term={term} />
      {hovered && <StateTooltip hovered={hovered} term={term} />}
    </div>
  );
}

function StateTooltip({ hovered, term }: { hovered: Hovered; term: 15 | 30 }) {
  const { entry, x, y } = hovered;
  const left = Math.min(x + 14, window.innerWidth - TIP_W - 8);
  const top = Math.min(y + 14, window.innerHeight - TIP_H - 8);
  const r30 = entry.latest_30;
  const r15 = entry.latest_15;
  return (
    <div className="map-tooltip" style={{ left, top }}>
      <div className="tt-header">
        <span className="tt-name">{entry.name}</span>
        <span className="tt-postal">{entry.postal}</span>
      </div>
      <div className="tt-body">
        <div className={`tt-row ${term === 30 ? "tt-row-focus" : ""}`}>
          <span className="tt-k">30-yr (today)</span>
          <span className="tt-val">{r30 != null ? `${r30.toFixed(2)}%` : "—"}</span>
        </div>
        <div className={`tt-row ${term === 15 ? "tt-row-focus" : ""}`}>
          <span className="tt-k">15-yr (today)</span>
          <span className="tt-val">{r15 != null ? `${r15.toFixed(2)}%` : "—"}</span>
        </div>
        {entry.has_hmda_band && (
          <div className="tt-row tt-row-divider">
            <span className="tt-k">HMDA 2024</span>
            <span className="tt-val">
              {entry.n_counties ?? "—"} counties · {(entry.n_loans_hmda ?? 0).toLocaleString()}{" "}
              loans
            </span>
          </div>
        )}
        {entry.live_trailing && (
          <div className="tt-row tt-muted">
            <span className="tt-k">Status</span>
            <span className="tt-val">live refresh</span>
          </div>
        )}
      </div>
      <div className="tt-hint">click to drill in →</div>
    </div>
  );
}

function ColorLegend({ minR, maxR, term }: { minR: number; maxR: number; term: number }) {
  const stops = 5;
  const values = Array.from({ length: stops }, (_, i) => minR + ((maxR - minR) * i) / (stops - 1));
  return (
    <div className="map-legend">
      <span className="legend-label">{term}-yr rate</span>
      {values.map((v) => (
        <span key={v} className="legend-stop" style={{ background: colorFor(v, minR, maxR) }}>
          {v.toFixed(2)}%
        </span>
      ))}
    </div>
  );
}
