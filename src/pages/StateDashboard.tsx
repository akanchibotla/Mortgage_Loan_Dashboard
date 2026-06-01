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
  const distFor = (c: (typeof counties)[number]) => (term === 15 ? c.term_15 : c.term_30);
  const sortedCounties = [...counties].sort((a, b) => distFor(b).n_loans - distFor(a).n_loans);
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

      <header className="state-hero">
        <div className="state-hero-titles">
          <p className="state-hero-eyebrow">State mortgage dashboard</p>
          <h1 className="state-hero-h1">
            {name} mortgage rates
            <span className="state-hero-postal">{data.meta.postal}</span>
          </h1>
          <p className="state-hero-sub">
            Today's quotes against the U.S. average and last year's HMDA closing distribution
            {counties.length > 0 ? ", county by county." : "."}
          </p>
        </div>
        <div
          className="page-term-toggle state-hero-toggle"
          role="tablist"
          aria-label="Loan term"
        >
          <button
            type="button"
            role="tab"
            aria-selected={term === 15}
            className={`pt-btn ${term === 15 ? "active" : ""}`}
            onClick={() => setTerm(15)}
          >
            15-year
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={term === 30}
            className={`pt-btn ${term === 30 ? "active" : ""}`}
            onClick={() => setTerm(30)}
          >
            30-year
          </button>
        </div>
      </header>

      {counties.length > 0 && (
        <section className="section">
          <div className="county-section-head">
            <h2>
              Drill into counties
              <span className="county-count-tag">{counties.length} with data</span>
            </h2>
            <p className="county-section-sub">
              Click any county on the map or list below to see its 2024 closed-loan distribution.
            </p>
          </div>
          <Suspense fallback={<p className="loading">Loading county map…</p>}>
            <CountyChoropleth
              stateSlug={slug}
              stateFips={data.meta.fips}
              counties={counties}
              term={term}
            />
          </Suspense>
          <div className="county-top">
            <h3 className="county-top-h3">
              Top counties by volume
              <span className="county-top-meta">2024 {term}-yr originations</span>
            </h3>
            <div className="county-top-grid">
              {topCounties.map((c) => {
                const dist = distFor(c);
                return (
                  <Link
                    key={c.fips}
                    to={`/state/${data.meta.slug}/county/${c.fips}`}
                    className="county-top-card"
                  >
                    <div className="county-top-card-head">
                      <span className="county-top-name">{c.name}</span>
                      <span className="county-top-rate">
                        {dist.simple_mean_pct != null
                          ? `${dist.simple_mean_pct.toFixed(2)}%`
                          : "—"}
                      </span>
                    </div>
                    <span className="county-top-volume">
                      {dist.n_loans.toLocaleString()} closings
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
          <details className="county-all">
            <summary>All {counties.length} counties (alphabetical)</summary>
            <ul className="county-list">
              {[...counties].sort((a, b) => a.name.localeCompare(b.name)).map((c) => {
                const dist = distFor(c);
                return (
                  <li key={c.fips}>
                    <Link to={`/state/${data.meta.slug}/county/${c.fips}`}>
                      {c.name}
                      {dist.n_loans > 0 && (
                        <span className="muted"> · {dist.n_loans.toLocaleString()} {term}-yr closings</span>
                      )}
                    </Link>
                  </li>
                );
              })}
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
          stateLabel={name}
          term={term}
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
        <p className="data-source-badges">
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
