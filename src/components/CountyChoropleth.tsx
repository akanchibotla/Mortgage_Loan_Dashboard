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
  selectedFips?: string;
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

export function CountyChoropleth({ stateSlug, stateFips, counties, term, selectedFips }: Props) {
  return (
    <Suspense fallback={<p className="loading">Loading {stateSlug} county map…</p>}>
      <ChoroplethBody
        stateSlug={stateSlug}
        stateFips={stateFips}
        counties={counties}
        term={term}
        selectedFips={selectedFips}
      />
    </Suspense>
  );
}

function ChoroplethBody({ stateSlug, stateFips, counties, term, selectedFips }: Props) {
  const navigate = useNavigate();
  const topo = use(getStateTopoPromise(stateFips));
  const [hovered, setHovered] = useState<{
    name: string;
    rate?: number;
    nLoans?: number;
    lowN?: boolean;
    x: number;
    y: number;
  } | null>(null);

  const byFips = useMemo(() => {
    const m = new Map<string, CountyEntry>();
    for (const c of counties) m.set(c.fips, c);
    return m;
  }, [counties]);

  // The colour domain is set by the counties whose distributions carry enough
  // loans to mean something. In 74 of 102 state/term maps an n<30 county held
  // the min or the max, stretching the ramp so far that every well-sampled
  // county collapsed into one or two indistinguishable hues (Nebraska 15-yr
  // ran 4.70–11.11 on the strength of single-loan counties). `low_n` is
  // already in the data; this just stops honouring it only in the badge.
  // Fall back to the full set when almost nothing qualifies, so a sparse
  // state still gets a scale instead of a flat map.
  const { minR, maxR } = useMemo(() => {
    const wellSampled = counties.filter(
      (c) => !(term === 15 ? c.term_15 : c.term_30).low_n,
    );
    const pool = wellSampled.length >= 2 ? wellSampled : counties;
    const rates = pool
      .map((c) => (term === 15 ? c.term_15.simple_mean_pct : c.term_30.simple_mean_pct))
      .filter((r): r is number => r != null);
    return rates.length
      ? { minR: Math.min(...rates) - 0.05, maxR: Math.max(...rates) + 0.05 }
      : { minR: 5.0, maxR: 7.5 };
  }, [counties, term]);

  const stateFeatures = topo?.counties.features ?? [];
  const stateBorder = topo?.state ?? null;

  const pathFn = useMemo(() => {
    if (!stateFeatures.length) return null;
    const fc: FeatureCollection<Geometry> = { type: "FeatureCollection", features: stateFeatures };
    const projection = geoAlbersUsa();
    projection.fitExtent([[20, 20], [WIDTH - 20, HEIGHT - 20]], fc);
    return geoPath(projection);
  }, [stateFeatures]);

  // Project once per geometry change, not once per render. Every pointer move
  // sets hover state, and re-running geoPath over the whole feature set
  // inside the render body made each of those frames pay the full projection
  // cost before React even diffed the path strings.
  const paths = useMemo(
    () =>
      pathFn
        ? stateFeatures.map((f) => ({
            feature: f,
            fips: String(f.id).padStart(5, "0"),
            d: pathFn(f) ?? "",
          }))
        : [],
    [stateFeatures, pathFn],
  );

  if (!topo || !pathFn) {
    return <p className="loading">No county map for {stateSlug}.</p>;
  }

  return (
    <div className="map-wrap">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="us-choropleth" preserveAspectRatio="xMidYMid meet">
        {paths.map(({ feature: f, fips, d }) => {
          const entry = byFips.get(fips);
          const dist = entry ? (term === 15 ? entry.term_15 : entry.term_30) : null;
          const rate = dist?.simple_mean_pct;
          const lowN = dist?.low_n === true;
          // A small-sample county renders in the neutral no-data grey rather
          // than being shaded on a mean drawn from a handful of loans. The
          // number itself is NOT hidden — it stays in the tooltip and the
          // aria-label with its loan count, so the reader can judge it.
          const fillRate = lowN ? null : rate;
          const hoverPayload = {
            name: entry?.name ?? f.properties?.name ?? "",
            rate,
            nLoans: dist?.n_loans,
            lowN,
          };
          return (
            <path
              key={fips}
              d={d}
              fill={colorFor(fillRate, minR, maxR)}
              stroke="#fff"
              strokeWidth={0.4}
              style={{ cursor: entry ? "pointer" : "default", transition: "fill 0.15s" }}
              aria-label={
                entry
                  ? `${entry.name} County: ${
                      rate != null
                        ? `${rate.toFixed(2)}% HMDA ${term}-yr mean from ${(dist?.n_loans ?? 0).toLocaleString()} closed loans${lowN ? " (small sample, shown as no data)" : ""}`
                        : "no data"
                    }`
                  : undefined
              }
              onMouseEnter={(e) => setHovered({ ...hoverPayload, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setHovered({ ...hoverPayload, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHovered(null)}
              onClick={() => entry && navigate(`/state/${stateSlug}/county/${fips}`)}
            />
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
        {selectedFips &&
          (() => {
            const sf = stateFeatures.find(
              (f) => String(f.id).padStart(5, "0") === selectedFips,
            );
            if (!sf) return null;
            return (
              <path
                d={pathFn(sf) ?? ""}
                fill="none"
                stroke="#000"
                strokeWidth={2.5}
                pointerEvents="none"
                vectorEffect="non-scaling-stroke"
              />
            );
          })()}
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
          {hovered.nLoans != null && (
            <>
              <br />
              {hovered.nLoans.toLocaleString()} closed loans
              {hovered.lowN ? " · small sample, unshaded" : ""}
            </>
          )}
        </div>
      )}
    </div>
  );
}
