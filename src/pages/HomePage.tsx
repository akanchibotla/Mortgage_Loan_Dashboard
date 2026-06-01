import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { loadPmms, loadStatesIndex } from "../lib/loadStateData";

const UsChoropleth = lazy(() =>
  import("../components/UsChoropleth").then((m) => ({ default: m.UsChoropleth })),
);

export default function HomePage() {
  const { states, built_at_utc } = loadStatesIndex();
  const { pmms15, pmms30 } = loadPmms();
  const latestUs15 = pmms15.at(-1);
  const latestUs30 = pmms30.at(-1);
  const [term, setTerm] = useState<15 | 30>(30);

  return (
    <>
      <h1>U.S. mortgage rates — by state, with HMDA-anchored context</h1>
      <p className="sub">
        For each U.S. state, compare today's quoted rates with the actual 2024 closed-loan
        distribution from HMDA. Daily auto-refresh from{" "}
        <a href="https://fred.stlouisfed.org">FRED</a>,{" "}
        <a href="https://www.bankrate.com">Bankrate</a>, and{" "}
        <a href="https://www.mortgagenewsdaily.com">Mortgage News Daily</a>.
      </p>

      <div className="notes">
        <b>U.S. baseline</b> (Freddie Mac PMMS, latest month):{" "}
        <b>15-yr FRM {latestUs15?.rate.toFixed(2)}%</b> ({latestUs15?.month}),{" "}
        <b>30-yr FRM {latestUs30?.rate.toFixed(2)}%</b> ({latestUs30?.month}).
      </div>

      <section className="section">
        <div className="map-controls">
          <h2>Pick a state</h2>
          <div className="term-toggle">
            <button
              type="button"
              className={term === 15 ? "active" : ""}
              onClick={() => setTerm(15)}
            >
              15-year
            </button>
            <button
              type="button"
              className={term === 30 ? "active" : ""}
              onClick={() => setTerm(30)}
            >
              30-year
            </button>
          </div>
        </div>
        <Suspense fallback={<p className="loading">Loading map…</p>}>
          <UsChoropleth index={states} term={term} />
        </Suspense>
        <p className="map-caption">
          Shaded states have data bundled ({states.length} of 51 today). Click any colored state to
          drill in. Gray = not yet backfilled.
        </p>
      </section>

      <section className="section">
        <h3>Available states (alphabetical)</h3>
        <ul className="state-list">
          {states.map((s) => (
            <li key={s.slug}>
              <Link to={`/state/${s.slug}`}>
                <span className="state-name">{s.name}</span>
                <span className="state-postal">{s.postal}</span>
                {term === 30
                  ? s.latest_30 != null && (
                      <span className="state-tag tag-rate">{s.latest_30.toFixed(2)}%</span>
                    )
                  : s.latest_15 != null && (
                      <span className="state-tag tag-rate">{s.latest_15.toFixed(2)}%</span>
                    )}
                {s.has_hmda_band && <span className="state-tag">HMDA</span>}
                {s.live_trailing && <span className="state-tag tag-live">live</span>}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="notes">
        <p>
          <b>Why this exists.</b> Bankrate and Zillow show today's quoted rates per state but no
          closed-loan reality. The FFIEC HMDA Data Browser shows actual closings per county but no
          quote comparison and no time series. The unique value here is combining both.
        </p>
        <p>
          Data refreshed{" "}
          {new Date(built_at_utc).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.{" "}
          See the <a href="https://github.com/akanchibotla/Mortgage_Loan_Dashboard">repo</a> and{" "}
          <a href="https://github.com/akanchibotla/Mortgage_Loan_Dashboard/blob/main/ROADMAP.md">
            roadmap
          </a>{" "}
          for the path to all 50 states + county drilldown + borrower calculator.
        </p>
      </div>
    </>
  );
}
