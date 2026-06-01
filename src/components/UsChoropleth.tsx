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
  latest_30: number | null;
  has_hmda_band: boolean;
  live_trailing: boolean;
}

interface Props {
  index: IndexEntry[];
  term: 15 | 30;
}

const WIDTH = 975;
const HEIGHT = 610;

function colorFor(rate: number | null, minR: number, maxR: number): string {
  if (rate == null) return "#e8e8e8";
  const t = Math.max(0, Math.min(1, (rate - minR) / (maxR - minR)));
  // Hue 130 (green) at low, 0 (red) at high.
  const hue = 130 - 130 * t;
  return `hsl(${hue}, 65%, 55%)`;
}

export function UsChoropleth({ index, term }: Props) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<{ slug: string; x: number; y: number } | null>(null);

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
    const fc = feature(topo, topo.objects.states) as unknown as FeatureCollection<Geometry, { name: string }>;
    return fc.features;
  }, []);

  const projection = useMemo(
    () => geoAlbersUsa().scale(1280).translate([WIDTH / 2, HEIGHT / 2]),
    [],
  );
  const pathFn = useMemo(() => geoPath(projection), [projection]);

  const hoveredEntry = hovered ? byFips.get(getFipsForFeature(features, hovered.slug)) : null;
  const hoveredRate = hoveredEntry
    ? term === 15 ? hoveredEntry.latest_15 : hoveredEntry.latest_30
    : null;

  return (
    <div className="map-wrap">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="us-choropleth" preserveAspectRatio="xMidYMid meet">
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
              onMouseEnter={(e) => entry && setHovered({ slug: entry.slug, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => entry && setHovered({ slug: entry.slug, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHovered(null)}
              onClick={() => entry && navigate(`/state/${entry.slug}`)}
            >
              <title>
                {entry
                  ? `${entry.name}: ${rate != null ? `${rate.toFixed(2)}% (${term}-yr)` : "no data"}`
                  : f.properties?.name ?? ""}
              </title>
            </path>
          );
        })}
      </svg>
      <ColorLegend minR={minR} maxR={maxR} term={term} />
      {hoveredEntry && hoveredRate != null && (
        <div className="map-tooltip" style={{ left: hovered!.x + 12, top: hovered!.y + 12 }}>
          <b>{hoveredEntry.name}</b>
          <br />
          {term}-yr Bankrate: {hoveredRate.toFixed(2)}%
        </div>
      )}
    </div>
  );
}

function getFipsForFeature(features: Feature<Geometry, { name: string }>[], slug: string): string {
  // We don't actually need this — the hovered.slug is already the slug, not feature id.
  // Kept for typing convenience.
  void features;
  return slug;
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
