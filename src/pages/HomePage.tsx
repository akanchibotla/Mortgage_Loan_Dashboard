import { Link } from "react-router-dom";
import { loadPmms, loadStateRegistry } from "../lib/loadStateData";

export default function HomePage() {
  const states = loadStateRegistry();
  const { pmms15, pmms30 } = loadPmms();
  const latestUs15 = pmms15.at(-1);
  const latestUs30 = pmms30.at(-1);

  return (
    <>
      <h1>U.S. mortgage rates — by state, with HMDA-anchored context</h1>
      <p className="sub">
        For each U.S. state, compare today's quoted mortgage rates with the actual 2024 closed-loan
        distribution from HMDA. Daily auto-refresh from{" "}
        <a href="https://fred.stlouisfed.org">FRED</a>,{" "}
        <a href="https://www.bankrate.com">Bankrate</a>, and{" "}
        <a href="https://www.mortgagenewsdaily.com">Mortgage News Daily</a>.
      </p>

      <div className="notes">
        <b>U.S. baseline (latest available)</b>
        <ul>
          <li>
            <b>15-yr FRM</b> — {latestUs15?.rate.toFixed(2)}% (Freddie Mac PMMS, {latestUs15?.month})
          </li>
          <li>
            <b>30-yr FRM</b> — {latestUs30?.rate.toFixed(2)}% (Freddie Mac PMMS, {latestUs30?.month})
          </li>
        </ul>
      </div>

      <section className="section">
        <h2>Pick a state</h2>
        {states.length === 0 ? (
          <p>No states have data bundled yet.</p>
        ) : (
          <ul className="state-list">
            {states.map((s) => (
              <li key={s.slug}>
                <Link to={`/state/${s.slug}`}>
                  <span className="state-name">{s.name}</span>
                  <span className="state-postal">{s.postal}</span>
                  {s.meta.has_hmda_band && <span className="state-tag">HMDA band</span>}
                  {s.meta.live_trailing && <span className="state-tag tag-live">live</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="notes">
        <p>
          <b>Why this exists.</b> Bankrate and Zillow show today's quoted rates per state but no
          closed-loan reality. The FFIEC HMDA Data Browser shows actual closings per county but no
          quote comparison and no time series. The unique value here is combining both, with explicit
          marker styles distinguishing high-confidence archived data from live pulls from MND/Bankrate.
        </p>
        <p>
          See the <a href="https://github.com/akanchibotla/Mortgage_Loan_Dashboard">repo</a> and{" "}
          <a href="https://github.com/akanchibotla/Mortgage_Loan_Dashboard/blob/main/ROADMAP.md">
            roadmap
          </a>{" "}
          for the path to all 50 states, county drilldown, and a borrower calculator.
        </p>
      </div>
    </>
  );
}
