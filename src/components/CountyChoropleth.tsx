import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import countiesTopo from "us-atlas/counties-10m.json";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { CountyEntry } from "../types";

interface Props {
  stateSlug: string;
  stateFips: string;
  counties: CountyEntry[];
  term: 15 | 30;
}

const WIDTH = 975;
const HEIGHT = 610;

function colorFor(rate: number | null | undefined, minR: number, maxR: number): string {
  if (rate == null) return "#e8e8e8";
  const t = Math.max(0, Math.min(1, (rate - minR) / (maxR - minR)));
  const hue = 130 - 130 * t;
  return `hsl(${hue}, 65%, 55%)`;
}

export function CountyChoropleth({ stateSlug, stateFips, counties, term }: Props) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<{ name: string; rate?: number; x: number; y: number } | null>(
    null,
  );

  const byFips = useMemo(() => {
    const m = new Map<string, CountyEntry>();
    for (const c of counties) m.set(c.fips, c);
    return m;
  }, [counties]);

  const filledRates = counties
    .map((c) => (term === 15 ? c.term_15.simple_mean_pct : c.term_30.simple_mean_pct))
    .filter((r): r is number => r != null);
  const minR = filledRates.length ? Math.min(...filledRates) - 0.05 : 5.0;
  const maxR = filledRates.length ? Math.max(...filledRates) + 0.05 : 7.5;

  const { stateFeatures, stateBorder } = useMemo(() => {
    const topo = countiesTopo as unknown as Topology<{
      states: GeometryCollection;
      counties: GeometryCollection;
    }>;
    const counties = feature(topo, topo.objects.counties) as unknown as FeatureCollection<
      Geometry,
      { name: string }
    >;
    const filtered = counties.features.filter((f) =>
      String(f.id).padStart(5, "0").startsWith(stateFips),
    );
    const stateMesh = mesh(topo, topo.objects.states, (a, b) => a !== b);
    return { stateFeatures: filtered, stateBorder: stateMesh };
  }, [stateFips]);

  // Compute a bounding-box-fitted projection for this state's counties.
  const { pathFn, viewBox } = useMemo(() => {
    const fc: FeatureCollection<Geometry> = {
      type: "FeatureCollection",
      features: stateFeatures,
    };
    const projection = geoAlbersUsa();
    projection.fitExtent(
      [[20, 20], [WIDTH - 20, HEIGHT - 20]],
      fc,
    );
    const pathFn = geoPath(projection);
    return { pathFn, viewBox: `0 0 ${WIDTH} ${HEIGHT}` };
  }, [stateFeatures]);

  return (
    <div className="map-wrap">
      <svg viewBox={viewBox} className="us-choropleth" preserveAspectRatio="xMidYMid meet">
        {stateFeatures.map((f: Feature<Geometry, { name: string }>) => {
          const fips = String(f.id).padStart(5, "0");
          const entry = byFips.get(fips);
          const dist = entry ? (term === 15 ? entry.term_15 : entry.term_30) : null;
          const rate = dist?.simple_mean_pct;
          const d = pathFn(f) ?? "";
          return (
            <path
              key={fips}
              d={d}
              fill={colorFor(rate, minR, maxR)}
              stroke="#fff"
              strokeWidth={0.4}
              style={{ cursor: entry ? "pointer" : "default", transition: "fill 0.15s" }}
              onMouseEnter={(e) =>
                setHovered({
                  name: entry?.name ?? f.properties?.name ?? "",
                  rate,
                  x: e.clientX,
                  y: e.clientY,
                })
              }
              onMouseMove={(e) =>
                setHovered({
                  name: entry?.name ?? f.properties?.name ?? "",
                  rate,
                  x: e.clientX,
                  y: e.clientY,
                })
              }
              onMouseLeave={() => setHovered(null)}
              onClick={() => entry && navigate(`/state/${stateSlug}/county/${fips}`)}
            >
              <title>
                {entry
                  ? `${entry.name} County: ${rate != null ? `${rate.toFixed(2)}% (HMDA ${term}-yr mean)` : "no data"}`
                  : ""}
              </title>
            </path>
          );
        })}
        <path
          d={pathFn(stateBorder) ?? ""}
          fill="none"
          stroke="#1a1a1a"
          strokeWidth={1.2}
          pointerEvents="none"
        />
      </svg>
      <div className="map-legend">
        <span className="legend-label">HMDA {term}-yr mean</span>
        {Array.from({ length: 5 }, (_, i) => minR + ((maxR - minR) * i) / 4).map((v) => (
          <span key={v} className="legend-stop" style={{ background: colorFor(v, minR, maxR) }}>
            {v.toFixed(2)}%
          </span>
        ))}
      </div>
      {hovered && (
        <div className="map-tooltip" style={{ left: hovered.x + 12, top: hovered.y + 12 }}>
          <b>{hovered.name}</b>
          <br />
          {hovered.rate != null
            ? `HMDA ${term}-yr mean: ${hovered.rate.toFixed(2)}%`
            : "no data"}
        </div>
      )}
    </div>
  );
}
