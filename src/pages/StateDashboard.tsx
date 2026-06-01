import { lazy, Suspense, useState, use } from "react";
import { Link, useParams } from "react-router-dom";
import { loadPmms, loadStateData, type StateData } from "../lib/loadStateData";
import { usePageMeta } from "../lib/usePageMeta";

const RateChart = lazy(() =>
  import("../components/RateChart").then((m) => ({ default: m.RateChart })),
);
const RateTable = lazy(() =>
  import("../components/RateTable").then((m) => ({ default: m.RateTable })),
);
const CountyChoropleth = lazy(() =>
  import("../components/CountyChoropleth").then((m) => ({ default: m.CountyChoropleth })),
);
const DemographicsPanel = lazy(() =>
  import("../components/DemographicsPanel").then((m) => ({ default: m.DemographicsPanel })),
);

const cache = new Map<string, Promise<StateData | null>>();

function getStatePromise(slug: string): Promise<StateData | null> {
  let p = cache.get(slug);
  if (!p) {
    p = loadStateData(slug);
    cache.set(slug, p);
  }
  return p;
}

export default function StateDashboard() {
  const { slug = "" } = useParams<{ slug: string }>();
  return (
    <Suspense fallback={<p className="loading">Loading {slug}…</p>}>
      <StateBody slug={slug} />
    </Suspense>
  );
}

function StateBody({ slug }: { slug: string }) {
  const data = use(getStatePromise(slug));
  const { pmms15, pmms30 } = loadPmms();
  const [term, setTerm] = useState<15 | 30>(30);
  const [tablePanelOpen, setTablePanelOpen] = useState(false);
  usePageMeta({
    title: data ? `${data.meta.name} mortgage rates` : `${slug} mortgage rates`,
    description: data
      ? `Today's Bankrate + Mortgage News Daily quotes for ${data.meta.name} 15-yr and 30-yr fixed mortgages alongside the HMDA 2024 actual closed-loan distribution and per-county breakdowns.`
      : undefined,
  });

  if (!data) {
    return (
      <div>
        <p className="breadcrumb">
          <Link to="/">&larr; All states</Link>
        </p>
        <h1>State not found</h1>
        <p>
          No data is currently bundled for slug <code>{slug}</code>.
        </p>
      </div>
    );
  }

  const name = data.meta.name;
  const hasMnd = data.mnd15?.some((p) => p.rate != null) || data.mnd30?.some((p) => p.rate != null);
  const counties = data.counties?.counties ?? [];
  const sortedCounties = [...counties].sort((a, b) => b.term_30.n_loans - a.term_30.n_loans);
  const topCounties = sortedCounties.slice(0, 6);

  const usData = term === 15 ? pmms15 : pmms30;
  const ncData = (term === 15 ? data.bankrate15 : data.bankrate30) ?? [];
  const mndData = (term === 15 ? data.mnd15 : data.mnd30) ?? undefined;
  const hmdaBand = term === 15 ? data.hmda15 : data.hmda30;
  const yMin = term === 15 ? 4.5 : 5.5;

  return (
    <>
      <button
        type="button"
        className={`side-panel-toggle ${tablePanelOpen ? "open rate-table-toggle-open" : ""}`}
        onClick={() => setTablePanelOpen((v) => !v)}
        aria-label={tablePanelOpen ? "Close monthly table" : "Open monthly comparison table"}
        title={tablePanelOpen ? "Hide monthly table" : "Show monthly comparison table"}
      >
        <span className="hamburger">{tablePanelOpen ? "✕" : "☰"}</span>
        <span className="toggle-label">{tablePanelOpen ? "Hide table" : "Monthly table"}</span>
      </button>

      {tablePanelOpen && (
        <div
          className="side-panel-backdrop"
          onClick={() => setTablePanelOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`side-panel rate-table-panel ${tablePanelOpen ? "open" : ""}`}
        aria-hidden={!tablePanelOpen}
      >
        <div className="side-panel-header">
          <div>
            <h3>
              {name} {term}-yr · monthly comparison
            </h3>
            <p className="side-panel-sub">U.S. PMMS vs {name} Bankrate, by month</p>
          </div>
          <button
            type="button"
            className="side-panel-close"
            onClick={() => setTablePanelOpen(false)}
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>
        {ncData.length > 0 ? (
          <Suspense fallback={<p className="loading">Loading table…</p>}>
            <RateTable usData={usData} ncData={ncData} />
          </Suspense>
        ) : (
          <p className="side-panel-empty">No Bankrate series available for this term.</p>
        )}
      </aside>

      <p className="breadcrumb">
        <Link to="/">&larr; All states</Link>
      </p>
      <h1>{name} mortgage rates — vs U.S.</h1>
      <p className="sub">
        <span className="badge">U.S.</span> Freddie Mac PMMS via FRED, monthly mean.{" "}
        <span className="badge">{data.meta.postal}</span> Bankrate (Wayback + live).{" "}
        {hasMnd && (
          <>
            <span className="badge">{data.meta.postal} MND</span> Mortgage News Daily.{" "}
          </>
        )}
        {hmdaBand && (
          <>
            <span className="badge">HMDA 2024 ref</span> {term}-yr origination band.
          </>
        )}
      </p>

      <div className="page-term-toggle" role="tablist" aria-label="Loan term">
        <button
          type="button"
          role="tab"
          aria-selected={term === 15}
          className={`pt-btn ${term === 15 ? "active" : ""}`}
          onClick={() => setTerm(15)}
        >
          15-year fixed
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={term === 30}
          className={`pt-btn ${term === 30 ? "active" : ""}`}
          onClick={() => setTerm(30)}
        >
          30-year fixed
        </button>
      </div>

      {counties.length > 0 && (
        <section className="section">
          <h2>Drill into counties</h2>
          <p className="sub">
            {counties.length} {name} counties have HMDA 2024 origination distributions. Click any
            county on the map (or in the list below) to see its closed-loan distribution.
          </p>
          <Suspense fallback={<p className="loading">Loading county map…</p>}>
            <CountyChoropleth
              stateSlug={slug}
              stateFips={data.meta.fips}
              counties={counties}
              term={term}
            />
          </Suspense>
          <h3 className="county-h3">Largest by 2024 30-yr origination volume</h3>
          <div className="kv-grid">
            {topCounties.map((c) => (
              <Link
                key={c.fips}
                to={`/state/${data.meta.slug}/county/${c.fips}`}
                className="kv kv-link"
              >
                <span className="k">{c.name} (n={c.term_30.n_loans.toLocaleString()})</span>
                <span className="v">
                  {c.term_30.simple_mean_pct?.toFixed(2)}%
                </span>
              </Link>
            ))}
          </div>
          <details className="county-all">
            <summary>All {counties.length} counties (alphabetical)</summary>
            <ul className="county-list">
              {[...counties].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                <li key={c.fips}>
                  <Link to={`/state/${data.meta.slug}/county/${c.fips}`}>
                    {c.name}
                    {c.term_30.n_loans > 0 && (
                      <span className="muted"> · n={c.term_30.n_loans.toLocaleString()}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      <section className="section">
        <h2>{term}-year fixed</h2>
        <RateChart
          usData={usData}
          ncData={ncData}
          mndData={mndData}
          hmdaBand={hmdaBand}
          title={`${term}-year fixed mortgage rate — ${name} vs U.S.`}
          usLabel={`U.S. ${term}-yr FRM (FRED MORTGAGE${term}US, monthly mean)`}
          ncLabel={`${name} ${term}-yr fixed (Bankrate, monthly)`}
          mndLabel={`${name} ${term}-yr fixed (Mortgage News Daily, monthly)`}
          yMin={yMin}
          yMax={7.5}
        />
        {ncData.length > 0 && (
          <p className="table-link-row">
            <button
              type="button"
              className="table-link-btn"
              onClick={() => setTablePanelOpen(true)}
            >
              View monthly comparison table →
            </button>
          </p>
        )}
      </section>

      {data.demographics && (
        <Suspense fallback={<p className="loading">Loading demographic breakdowns…</p>}>
          <DemographicsPanel data={data.demographics} stateName={name} term={term} />
        </Suspense>
      )}

      <div className="notes">
        <b>Sources &amp; method</b>
        <ul>
          <li>
            <b>U.S. line</b> —{" "}
            <a href="https://fred.stlouisfed.org/series/MORTGAGE15US">FRED MORTGAGE15US</a> /{" "}
            <a href="https://fred.stlouisfed.org/series/MORTGAGE30US">MORTGAGE30US</a>; monthly mean of
            weekly observations.
          </li>
          <li>
            <b>{name} line</b> — Bankrate {name} page; historical from{" "}
            <a href="https://web.archive.org/">Internet Archive</a> snapshots; trailing month from today's
            live page via headless Chromium. Months without Wayback or live coverage render as gaps.
          </li>
          {hasMnd && (
            <li>
              <b>{name} MND</b> — daily NC rate from{" "}
              <a href={`https://www.mortgagenewsdaily.com/mortgage-rates/${slug}`}>Mortgage News Daily</a>;
              Wayback historical (sparse) + forward daily collection.
            </li>
          )}
          {hmdaBand && (
            <li>
              <b>HMDA 2024 reference band</b> ({term}-yr) —{" "}
              <a href="https://ffiec.cfpb.gov/data-browser/">FFIEC HMDA 2024 LAR</a>, filtered to{" "}
              {data.meta.postal} + home purchase + originated + loan_term=
              {term === 15 ? "180" : "360"} (n=
              {hmdaBand.n_loans.toLocaleString()}). Outer band p10–p90 (
              {hmdaBand.p10_pct.toFixed(2)}%–{hmdaBand.p90_pct.toFixed(2)}%); inner box p25–p75; dashed
              lines mark simple and amount-weighted mean. HMDA has no month field, so this is one annual
              figure.
            </li>
          )}
          <li>
            Different methodologies (lender survey vs. lock-flow vs. lender-aggregate quote) explain ~10–30
            bp gaps even on the same date.
          </li>
        </ul>
      </div>
    </>
  );
}
