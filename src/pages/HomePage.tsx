import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadPmms, loadStatesIndex } from "../lib/loadStateData";
import { usePageMeta, BASE_TITLE } from "../lib/usePageMeta";

const UsChoropleth = lazy(() =>
  import("../components/UsChoropleth").then((m) => ({ default: m.UsChoropleth })),
);

export default function HomePage() {
  const { states, built_at_utc } = loadStatesIndex();
  const { pmms15, pmms30 } = loadPmms();
  const latestUs15 = pmms15.at(-1);
  const latestUs30 = pmms30.at(-1);
  const [term, setTerm] = useState<15 | 30>(30);
  const [panelOpen, setPanelOpen] = useState(false);
  const [filter, setFilter] = useState("");
  usePageMeta({ title: BASE_TITLE });

  // Default the panel open on wide screens, closed on narrow.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setPanelOpen(window.innerWidth >= 1024);
  }, []);

  const filteredStates = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return states;
    return states.filter(
      (s) => s.name.toLowerCase().includes(f) || s.postal.toLowerCase().includes(f),
    );
  }, [states, filter]);

  return (
    <>
      <StatePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        states={states}
        filteredStates={filteredStates}
        term={term}
        filter={filter}
        onFilter={setFilter}
      />
      <button
        type="button"
        className={`side-panel-toggle ${panelOpen ? "open" : ""}`}
        onClick={() => setPanelOpen((v) => !v)}
        aria-label={panelOpen ? "Close state list" : "Open state list"}
        title={panelOpen ? "Hide state list" : "Show all states"}
      >
        <span className="hamburger">{panelOpen ? "✕" : "☰"}</span>
        <span className="toggle-label">{panelOpen ? "Hide" : "All states"}</span>
      </button>

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
      <div className="notes">
        <b>Coverage today:</b> {states.length} of 51 states bundled.{" "}
        <b>{states.filter((s) => s.has_hmda_band).length}</b> with HMDA 2024 distributions + county
        drilldowns. <b>{states.filter((s) => s.latest_30 != null).length}</b> with daily-refreshing
        Bankrate/MND rate quotes.
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
          Hover any state for a snapshot, click to drill into its dashboard. Use the{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => setPanelOpen(true)}
          >
            state list panel
          </button>{" "}
          on the left for an alphabetical view with search.
        </p>
      </section>

      <div className="notes">
        <p>
          <b>Why this exists.</b> Bankrate and Zillow show today's quoted rates per state but no
          closed-loan reality. The FFIEC HMDA Data Browser shows actual closings per county but no
          quote comparison and no time series. The unique value here is combining both.
        </p>
        <p>
          Data refreshed{" "}
          {new Date(built_at_utc).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
          . See the <a href="https://github.com/akanchibotla/Mortgage_Loan_Dashboard">repo</a> and{" "}
          <a href="https://github.com/akanchibotla/Mortgage_Loan_Dashboard/blob/main/ROADMAP.md">
            roadmap
          </a>
          .
        </p>
      </div>
    </>
  );
}

interface PanelProps {
  open: boolean;
  onClose: () => void;
  states: ReturnType<typeof loadStatesIndex>["states"];
  filteredStates: ReturnType<typeof loadStatesIndex>["states"];
  term: 15 | 30;
  filter: string;
  onFilter: (v: string) => void;
}

function StatePanel({
  open,
  onClose,
  states,
  filteredStates,
  term,
  filter,
  onFilter,
}: PanelProps) {
  return (
    <>
      {open && <div className="side-panel-backdrop" onClick={onClose} aria-hidden="true" />}
      <aside className={`side-panel ${open ? "open" : ""}`} aria-hidden={!open}>
        <div className="side-panel-header">
          <div>
            <h3>States ({states.length})</h3>
            <p className="side-panel-sub">
              {term}-yr rate · click to drill in
            </p>
          </div>
          <button
            type="button"
            className="side-panel-close"
            onClick={onClose}
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>
        <input
          type="search"
          placeholder="Filter by name or postal…"
          className="side-panel-search"
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
        />
        <ul className="side-panel-list">
          {filteredStates.length === 0 ? (
            <li className="side-panel-empty">No states match "{filter}"</li>
          ) : (
            filteredStates.map((s) => {
              const rate = term === 30 ? s.latest_30 : s.latest_15;
              return (
                <li key={s.slug}>
                  <Link to={`/state/${s.slug}`} onClick={onClose}>
                    <span className="sp-name">{s.name}</span>
                    <span className="sp-postal">{s.postal}</span>
                    <span className="sp-rate">{rate != null ? `${rate.toFixed(2)}%` : "—"}</span>
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      </aside>
    </>
  );
}
