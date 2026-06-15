import { lazy, Suspense, useEffect, useRef, useState, use, type PointerEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { loadPmms, loadRocket, loadStateData, type StateData } from "../lib/loadStateData";
import { usePageMeta } from "../lib/usePageMeta";
import { useTermPreference } from "../lib/useTermPreference";
import { useCalculator } from "../lib/useCalculator";
import { fmtMoney, monthlyPayment } from "../lib/payment";
import type { CountyEntry } from "../types";
import { ErrorBoundary } from "../components/ErrorBoundary";

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
const AmortPanel = lazy(() =>
  import("../components/AmortPanel").then((m) => ({ default: m.AmortPanel })),
);

const PANEL_WIDTH_DEFAULT = 480;
const PANEL_WIDTH_MIN = 360;
const PANEL_WIDTH_MAX = 1100;

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
    <ErrorBoundary label={`data for ${slug}`}>
      <Suspense fallback={<p className="loading">Loading {slug}…</p>}>
        <StateBody slug={slug} />
      </Suspense>
    </ErrorBoundary>
  );
}

function StateBody({ slug }: { slug: string }) {
  const data = use(getStatePromise(slug));
  const { pmms15, pmms30 } = loadPmms();
  const { rocket15, rocket30 } = loadRocket();
  const [term, setTerm] = useTermPreference();
  const [tablePanelOpen, setTablePanelOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState<number>(PANEL_WIDTH_DEFAULT);
  const [tableSession, setTableSession] = useState(0);
  const draggingRef = useRef(false);
  const [selectedCountyFips, setSelectedCountyFips] = useState<string>("");
  const [timescale, setTimescale] = useState<"monthly" | "weekly">("monthly");

  // Resized width is ephemeral: every close (and page load) snaps it back
  // to PANEL_WIDTH_DEFAULT so the next open starts from a known baseline.
  // Bumping tableSession on each open also remounts <RateTable> via its
  // key, which drops any expanded weekly-breakdown row carried over from
  // the previous open — same "fresh table on each open" intent.
  useEffect(() => {
    if (!tablePanelOpen) {
      setPanelWidth(PANEL_WIDTH_DEFAULT);
    } else {
      setTableSession((s) => s + 1);
    }
  }, [tablePanelOpen]);

  function onResizeStart(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onResizeMove(e: PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    // Panel is left-anchored, so cursor's clientX === panel's right edge.
    const next = Math.max(
      PANEL_WIDTH_MIN,
      Math.min(PANEL_WIDTH_MAX, Math.round(e.clientX)),
    );
    setPanelWidth(next);
  }
  function onResizeEnd(e: PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture may already be gone
    }
  }
  usePageMeta({
    title: data ? `${data.meta.name} mortgage rates` : `${slug} mortgage rates`,
    description: data
      ? `Today's Bankrate + Mortgage News Daily quotes for ${data.meta.name} 15-yr and 30-yr fixed mortgages alongside the HMDA 2024 actual closed-loan distribution and per-county breakdowns.`
      : undefined,
  });

  if (!data) {
    return (
      <div>
        <h1>State not found</h1>
        <p>
          No data is currently bundled for slug <code>{slug}</code>.
        </p>
      </div>
    );
  }

  const name = data.meta.name;
  const counties = data.counties?.counties ?? [];
  const distFor = (c: (typeof counties)[number]) => (term === 15 ? c.term_15 : c.term_30);
  const sortedCounties = [...counties].sort((a, b) => distFor(b).n_loans - distFor(a).n_loans);
  const topCounties = sortedCounties.slice(0, 5);

  const usData = term === 15 ? pmms15 : pmms30;
  const rocketData = (term === 15 ? rocket15 : rocket30) ?? undefined;
  const ncData = (term === 15 ? data.bankrate15 : data.bankrate30) ?? [];
  const mndData = (term === 15 ? data.mnd15 : data.mnd30) ?? undefined;
  const nwData = (term === 15 ? data.nerdwallet15 : data.nerdwallet30) ?? undefined;
  const ncDaily = (term === 15 ? data.bankrate15Daily : data.bankrate30Daily) ?? undefined;
  const mndDaily = (term === 15 ? data.mnd15Daily : data.mnd30Daily) ?? undefined;
  const hmdaBand = term === 15 ? data.hmda15 : data.hmda30;
  const yMin = term === 15 ? 4.5 : 5.5;

  return (
    <>
      <button
        type="button"
        className={`side-panel-toggle ${tablePanelOpen ? "open rate-table-toggle-open" : ""}`}
        style={tablePanelOpen ? { left: `${panelWidth + 12}px` } : undefined}
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
      {tablePanelOpen && (
        <div
          className="side-panel-resizer"
          style={{ left: `${panelWidth}px` }}
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize monthly comparison panel"
          aria-valuenow={panelWidth}
          aria-valuemin={PANEL_WIDTH_MIN}
          aria-valuemax={PANEL_WIDTH_MAX}
          title="Drag to resize"
        />
      )}
      <aside
        className={`side-panel rate-table-panel ${tablePanelOpen ? "open" : ""}`}
        aria-hidden={!tablePanelOpen}
        style={{ width: `${panelWidth}px` }}
      >
        <div className="side-panel-header">
          <div>
            <h3>
              {name} {term}-yr · monthly comparison
            </h3>
            <p className="side-panel-sub">U.S. PMMS vs {name} Bankrate, by month</p>
          </div>
        </div>
        {ncData.length > 0 ? (
          <Suspense fallback={<p className="loading">Loading table…</p>}>
            <RateTable
              key={tableSession}
              usData={usData}
              ncData={ncData}
              mndData={mndData}
              nwData={nwData}
              mndDaily={mndDaily}
              stateLabel={name}
            />
          </Suspense>
        ) : (
          <p className="side-panel-empty">No Bankrate series available for this term.</p>
        )}
      </aside>

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

      <section className="section">
        <div className="rate-chart-header">
          <h2>{term}-year fixed</h2>
          <div
            className="rate-timescale-toggle"
            role="tablist"
            aria-label="Chart time scale"
          >
            <button
              type="button"
              role="tab"
              aria-selected={timescale === "monthly"}
              className={`pt-btn ${timescale === "monthly" ? "active" : ""}`}
              onClick={() => setTimescale("monthly")}
            >
              Monthly
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={timescale === "weekly"}
              className={`pt-btn ${timescale === "weekly" ? "active" : ""}`}
              onClick={() => setTimescale("weekly")}
            >
              Weekly
            </button>
          </div>
        </div>
        <RateChart
          usData={usData}
          rocketData={rocketData}
          ncData={ncData}
          mndData={mndData}
          nwData={nwData}
          ncDaily={ncDaily}
          mndDaily={mndDaily}
          timescale={timescale}
          hmdaBand={hmdaBand}
          title={`${term}-year fixed mortgage rate — ${name} vs U.S.`}
          usLabel={`U.S. ${term}-yr FRM (FRED MORTGAGE${term}US, monthly mean)`}
          rocketLabel={`Rocket Mortgage ${term}-yr fixed (national)`}
          ncLabel={`${name} ${term}-yr fixed (Bankrate, ${timescale})`}
          mndLabel={`${name} ${term}-yr fixed (Mortgage News Daily, ${timescale})`}
          nwLabel={`${name} ${term}-yr fixed (NerdWallet state average)`}
          yMin={yMin}
          yMax={7.5}
          stateLabel={name}
          term={term}
          footerRight={
            ncData.length > 0 ? (
              <button
                type="button"
                className="table-link-btn"
                onClick={() => setTablePanelOpen(true)}
              >
                View monthly comparison table →
              </button>
            ) : undefined
          }
        />
      </section>

      <StateCalculator
        stateName={name}
        stateRate={(term === 15 ? data.bankrate15?.at(-1)?.rate : data.bankrate30?.at(-1)?.rate) ?? null}
        counties={counties}
        term={term}
        selectedCountyFips={selectedCountyFips}
        onSelectedCountyChange={setSelectedCountyFips}
      />

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
              selectedFips={selectedCountyFips}
            />
          </Suspense>
          <div className="county-top">
            <h3 className="county-top-h3">
              Top counties by volume
              <span className="county-top-meta">2024 {term}-year closed loans</span>
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

      {data.demographics && (
        <details className="demographics-disclosure">
          <summary>
            <span className="dd-summary-label">Show HMDA demographic breakdowns</span>
            <span className="dd-summary-meta">race · sex · loan size</span>
          </summary>
          <Suspense fallback={<p className="loading">Loading demographic breakdowns…</p>}>
            <DemographicsPanel data={data.demographics} stateName={name} term={term} />
          </Suspense>
        </details>
      )}

    </>
  );
}

function StateCalculator({
  stateName,
  stateRate,
  counties,
  term,
  selectedCountyFips,
  onSelectedCountyChange,
}: {
  stateName: string;
  stateRate: number | null;
  counties: CountyEntry[];
  term: 15 | 30;
  selectedCountyFips: string;
  onSelectedCountyChange: (fips: string) => void;
}) {
  const { loanAmount, setLoanAmount, rateText, setRateText } = useCalculator();
  const [amortOpen, setAmortOpen] = useState(false);

  const sortedCounties = [...counties].sort((a, b) => a.name.localeCompare(b.name));
  const selectedCounty = counties.find((c) => c.fips === selectedCountyFips) ?? null;
  const countyRate = selectedCounty
    ? (term === 15 ? selectedCounty.term_15.simple_mean_pct : selectedCounty.term_30.simple_mean_pct) ?? null
    : null;

  const anchorRate = countyRate ?? stateRate;
  const anchorSource: "county" | "state" | "none" =
    countyRate != null ? "county" : stateRate != null ? "state" : "none";

  const fallbackRate = anchorRate ?? 6.5;
  const customRate = rateText.trim() === "" ? null : parseFloat(rateText);
  const effectiveRate =
    customRate != null && Number.isFinite(customRate) ? customRate : fallbackRate;
  const monthly = monthlyPayment(loanAmount, effectiveRate, term);
  const totalPaid = monthly * term * 12;
  const totalInterest = Math.max(0, totalPaid - loanAmount);
  const principalPct =
    totalPaid > 0 ? Math.max(0, Math.min(100, (loanAmount / totalPaid) * 100)) : 0;
  const interestPct = 100 - principalPct;

  const rateInputValue =
    rateText === "" && anchorRate != null ? anchorRate.toFixed(2) : rateText;
  const isCustomRate =
    customRate != null && anchorRate != null && Math.abs(customRate - anchorRate) > 0.001;

  return (
    <section className="state-calc">
      <p className="state-calc-eyebrow">Estimated payment</p>
      <h2 className="state-calc-h2">Your {stateName} mortgage</h2>
      <p className="state-calc-sub">
        {anchorSource === "county" && selectedCounty ? (
          <>
            Anchored to <b>{selectedCounty.name} County</b>'s 2024 {term}-yr HMDA mean
            {countyRate != null ? ` (${countyRate.toFixed(2)}%)` : ""}. Edit any field to model
            scenarios.
          </>
        ) : anchorSource === "state" ? (
          <>
            Anchored to <b>{stateName}</b>'s latest {term}-yr Bankrate quote
            {stateRate != null ? ` (${stateRate.toFixed(2)}%)` : ""}. Pick a county to switch the
            anchor to its 2024 HMDA mean.
          </>
        ) : (
          <>No rate available — enter one manually below to estimate your payment.</>
        )}
      </p>

      <div className="state-calc-grid">
        <label className="state-calc-field">
          <span className="sc-field-label">Loan amount</span>
          <span className="sc-field-prefix">$</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={5_000}
            value={loanAmount}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v) && v >= 0) setLoanAmount(v);
            }}
            className="sc-field-input"
          />
        </label>
        <label className="state-calc-field sc-field-select-wrap">
          <span className="sc-field-label">County (optional)</span>
          <select
            className="sc-field-select"
            value={selectedCountyFips}
            onChange={(e) => onSelectedCountyChange(e.target.value)}
            disabled={sortedCounties.length === 0}
          >
            <option value="">— Statewide —</option>
            {sortedCounties.map((c) => (
              <option key={c.fips} value={c.fips}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="state-calc-field">
          <span className="sc-field-label">Rate</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={0.05}
            value={rateInputValue}
            onChange={(e) => setRateText(e.target.value)}
            className="sc-field-input"
          />
          <span className="sc-field-suffix">%</span>
        </label>
        <div className="state-calc-field sc-field-readonly">
          <span className="sc-field-label">Term</span>
          <span className="sc-field-readonly-value">{term}-year</span>
        </div>
      </div>

      <div className="state-calc-output">
        <div className="sc-output-row sc-output-main">
          <span className="sc-output-label">Monthly P&amp;I</span>
          <span className="sc-output-value">{fmtMoney(monthly)}</span>
        </div>
        {totalPaid > 0 && (
          <div
            className="amort"
            title={`Amortized over ${term} years at ${effectiveRate.toFixed(2)}%`}
          >
            <div
              className="amort-bar"
              role="img"
              aria-label={`Loan split: ${fmtMoney(loanAmount)} principal, ${fmtMoney(totalInterest)} interest`}
            >
              <div
                className="amort-bar-seg amort-principal"
                style={{ width: `${principalPct}%` }}
              />
              <div
                className="amort-bar-seg amort-interest"
                style={{ width: `${interestPct}%` }}
              />
            </div>
            <div className="amort-legend">
              <span>
                <span className="amort-dot amort-dot-p" />
                {fmtMoney(loanAmount)} principal
              </span>
              <span>
                <span className="amort-dot amort-dot-i" />
                {fmtMoney(totalInterest)} interest
              </span>
            </div>
            <div className="amort-total">
              <b>{fmtMoney(totalPaid)}</b> paid over {term} years
            </div>
          </div>
        )}
        {isCustomRate && (
          <div className="sc-output-hint">
            <button
              type="button"
              className="sc-reset-btn"
              onClick={() => setRateText("")}
              title={
                anchorSource === "county" && selectedCounty
                  ? `Reset to ${selectedCounty.name} County's ${term}-yr HMDA mean`
                  : `Reset to ${stateName}'s ${term}-yr quote`
              }
            >
              Reset rate
            </button>
          </div>
        )}
      </div>

      <details
        className="state-calc-amort"
        onToggle={(e) => {
          // Guard against nested-details toggle events (the new product-
          // header disclosure inside AmortPanel). Without this, closing
          // the description would also collapse the entire amortization.
          if (e.target !== e.currentTarget) return;
          setAmortOpen(e.currentTarget.open);
        }}
      >
        <summary>
          <span className="sca-summary-label">See month-by-month amortization</span>
          <span className="sca-summary-meta">
            {term * 12} payments · chart + table
          </span>
        </summary>
        {amortOpen && (
          <ErrorBoundary label="amortization">
            <Suspense fallback={<p className="loading">Loading amortization…</p>}>
              <AmortPanel
                loanAmount={loanAmount}
                annualRatePct={effectiveRate}
                termYears={term}
              />
            </Suspense>
          </ErrorBoundary>
        )}
      </details>
    </section>
  );
}
