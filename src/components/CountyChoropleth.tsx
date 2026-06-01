import { Suspense, use, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { geoAlbersUsa, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { CountyEntry } from "../types";

interface Props {
  stateSlug: string;
  stateFips: string;
  counties: CountyEntry[];
  term: 15 | 30;
}

interface StateTopoFile {
  state_fips: string;
  n_counties: number;
  counties: FeatureCollection<Geometry, { name: string }>;
  state: Feature<Geometry, { name: string }> | null;
}

const stateTopoLoaders = import.meta.glob("../data/topo/*.json", {
  import: "default",
}) as Record<string, () => Promise<unknown>>;

const stateTopoCache = new Map<string, Promise<StateTopoFile | null>>();

function getStateTopoPromise(fips: string): Promise<StateTopoFile | null> {
  if (stateTopoCache.has(fips)) return stateTopoCache.get(fips)!;
  const loader = stateTopoLoaders[`../data/topo/${fips}.json`];
  const p = loader
    ? (loader() as Promise<StateTopoFile>)
    : Promise.resolve(null);
  stateTopoCache.set(fips, p);
  return p;
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
  return (
    <Suspense fallback={<p className="loading">Loading {stateSlug} county map…</p>}>
      <ChoroplethBody stateSlug={stateSlug} stateFips={stateFips} counties={counties} term={term} />
    </Suspense>
  );
}

function ChoroplethBody({ stateSlug, stateFips, counties, term }: Props) {
  const navigate = useNavigate();
  const topo = use(getStateTopoPromise(stateFips));
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

  const stateFeatures = topo?.counties.features ?? [];
  const stateBorder = topo?.state ?? null;

  const pathFn = useMemo(() => {
    if (!stateFeatures.length) return null;
    const fc: FeatureCollection<Geometry> = { type: "FeatureCollection", features: stateFeatures };
    const projection = geoAlbersUsa();
    projection.fitExtent([[20, 20], [WIDTH - 20, HEIGHT - 20]], fc);
    return geoPath(projection);
  }, [stateFeatures]);

  if (!topo || !pathFn) {
    return <p className="loading">No county map for {stateSlug}.</p>;
  }

  return (
    <div className="map-wrap">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="us-choropleth" preserveAspectRatio="xMidYMid meet">
        {stateFeatures.map((f) => {
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
        {stateBorder && (
          <path
            d={pathFn(stateBorder) ?? ""}
            fill="none"
            stroke="#1a1a1a"
            strokeWidth={1.2}
            pointerEvents="none"
          />
        )}
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
          {hovered.rate != null ? `HMDA ${term}-yr mean: ${hovered.rate.toFixed(2)}%` : "no data"}
        </div>
      )}
    </div>
  );
}
