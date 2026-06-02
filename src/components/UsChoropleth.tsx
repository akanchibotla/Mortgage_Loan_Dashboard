import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import statesTopo from "us-atlas/states-10m.json";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { HmdaQuickStats, StatesIndexEntry } from "../lib/loadStateData";
import { fmtMoney, fmtRate, monthlyPayment } from "../lib/payment";

interface Props {
  index: StatesIndexEntry[];
  term: 15 | 30;
  loanAmount: number;
  selectedSlug?: string;
}

const WIDTH = 975;
const HEIGHT = 610;
const TIP_W = 290;
const TIP_H = 280;

function colorFor(rate: number | null, minR: number, maxR: number): string {
  if (rate == null) return "#e8e8e8";
  const t = Math.max(0, Math.min(1, (rate - minR) / (maxR - minR)));
  const hue = 130 - 130 * t;
  return `hsl(${hue}, 65%, 55%)`;
}

interface Hovered {
  entry: StatesIndexEntry;
  x: number;
  y: number;
}

export function UsChoropleth({ index, term, loanAmount, selectedSlug }: Props) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<Hovered | null>(null);

  const byFips = useMemo(() => {
    const m = new Map<string, StatesIndexEntry>();
    for (const s of index) m.set(s.fips, s);
    return m;
  }, [index]);

  const selectedFips = useMemo(() => {
    if (!selectedSlug) return null;
    return index.find((s) => s.slug === selectedSlug)?.fips ?? null;
  }, [index, selectedSlug]);

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
        {selectedFips &&
          (() => {
            const sf = features.find(
              (f) => String(f.id).padStart(2, "0") === selectedFips,
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
      <ColorLegend minR={minR} maxR={maxR} term={term} />
      {hovered && <StateTooltip hovered={hovered} term={term} loanAmount={loanAmount} />}
    </div>
  );
}

function StateTooltip({
  hovered,
  term,
  loanAmount,
}: {
  hovered: Hovered;
  term: 15 | 30;
  loanAmount: number;
}) {
  const { entry, x, y } = hovered;
  const left = Math.min(x + 14, window.innerWidth - TIP_W - 8);
  const top = Math.min(y + 14, window.innerHeight - TIP_H - 8);
  const live = term === 30 ? entry.latest_30 : entry.latest_15;
  const hmda: HmdaQuickStats | null | undefined = term === 30 ? entry.hmda_30 : entry.hmda_15;
  const livePI = live != null ? monthlyPayment(loanAmount, live, term) : null;
  return (
    <div className="map-tooltip" style={{ left, top }}>
      <div className="tt-header">
        <span className="tt-name">{entry.name}</span>
        <span className="tt-postal">{entry.postal}</span>
      </div>
      <div className="tt-section">
        <div className="tt-section-label">Today's market</div>
        <div className="tt-row tt-row-focus">
          <span className="tt-k">{term}-yr quoted</span>
          <span className="tt-val">{fmtRate(live)}</span>
        </div>
        <div className="tt-row tt-row-focus">
          <span className="tt-k">Est. monthly P&amp;I</span>
          <span className="tt-val tt-money">{livePI != null ? fmtMoney(livePI) : "—"}</span>
        </div>
      </div>
      {hmda?.p50 != null && (
        <div className="tt-section">
          <div className="tt-section-label">
            HMDA 2024 actuals <span className="tt-section-n">n={hmda.n?.toLocaleString()}</span>
          </div>
          <div className="tt-row">
            <span className="tt-k">Median (p50)</span>
            <span className="tt-val">
              {fmtRate(hmda.p50)} · {fmtMoney(monthlyPayment(loanAmount, hmda.p50, term))}
            </span>
          </div>
          {hmda.p10 != null && (
            <div className="tt-row tt-row-low">
              <span className="tt-k">Best 10% (p10)</span>
              <span className="tt-val">
                {fmtRate(hmda.p10)} · {fmtMoney(monthlyPayment(loanAmount, hmda.p10, term))}
              </span>
            </div>
          )}
          {hmda.p90 != null && (
            <div className="tt-row tt-row-high">
              <span className="tt-k">Worst 10% (p90)</span>
              <span className="tt-val">
                {fmtRate(hmda.p90)} · {fmtMoney(monthlyPayment(loanAmount, hmda.p90, term))}
              </span>
            </div>
          )}
        </div>
      )}
      <div className="tt-hint">click to drill into {entry.name} →</div>
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
