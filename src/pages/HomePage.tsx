import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadPmms, loadStatesIndex } from "../lib/loadStateData";
import { usePageMeta, BASE_TITLE } from "../lib/usePageMeta";
import { fmtMoney, fmtRate, monthlyPayment } from "../lib/payment";

const UsChoropleth = lazy(() =>
  import("../components/UsChoropleth").then((m) => ({ default: m.UsChoropleth })),
);

const DEFAULT_LOAN = 350_000;

export default function HomePage() {
  const { states, built_at_utc } = loadStatesIndex();
  const { pmms15, pmms30 } = loadPmms();
  const latestUs15 = pmms15.at(-1);
  const latestUs30 = pmms30.at(-1);
  const [term, setTerm] = useState<15 | 30>(30);
  const [loanAmount, setLoanAmount] = useState(DEFAULT_LOAN);
  const [panelOpen, setPanelOpen] = useState(false);
  const [filter, setFilter] = useState("");
  usePageMeta({ title: BASE_TITLE });

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

  const usRate = term === 15 ? latestUs15?.rate : latestUs30?.rate;
  const usMonth = term === 15 ? latestUs15?.month : latestUs30?.month;
  const usPI = usRate != null ? monthlyPayment(loanAmount, usRate, term) : null;

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

      {/* CALCULATOR HERO — interactive controls that drive the map below */}
      <section className="hero hero-calc">
        <p className="hero-eyebrow">Mortgage calculator</p>
        <h1 className="hero-title">
          Your loan, <span className="accent">every state</span>.
        </h1>
        <p className="hero-sub">
          Enter your loan basics, then hover any state on the map below to see today's quoted rate,
          your estimated monthly payment, and where you'd land in that state's actual 2024
          closed-loan distribution.
        </p>

        <div className="calc-inputs">
          <label className="calc-input">
            <span className="calc-input-label">Loan amount</span>
            <div className="amount-wrap">
              <span className="amount-prefix">$</span>
              <input
                type="number"
                min={25_000}
                max={5_000_000}
                step={5_000}
                value={loanAmount}
                onChange={(e) => setLoanAmount(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
            <input
              type="range"
              min={50_000}
              max={2_000_000}
              step={5_000}
              value={Math.min(loanAmount, 2_000_000)}
              onChange={(e) => setLoanAmount(Number(e.target.value))}
              className="amount-slider"
            />
            <div className="amount-ticks">
              <span>$50K</span>
              <span>$500K</span>
              <span>$1M</span>
              <span>$1.5M</span>
              <span>$2M</span>
            </div>
          </label>

          <label className="calc-input">
            <span className="calc-input-label">Loan term</span>
            <div className="term-toggle term-toggle-lg">
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
          </label>

          <div className="calc-output-card">
            <div className="calc-out-label">U.S. national (FRED PMMS, {usMonth ?? "—"})</div>
            <div className="calc-out-row">
              <span className="calc-out-rate">{fmtRate(usRate)}</span>
              <span className="calc-out-arrow">→</span>
              <span className="calc-out-payment">{fmtMoney(usPI)}/mo</span>
            </div>
            <div className="calc-out-hint">↓ Hover a state below for state-specific numbers</div>
          </div>
        </div>
      </section>

      {/* MAP */}
      <section className="section">
        <div className="map-controls map-controls-flat">
          <h2>Pick a state</h2>
          <span className="map-controls-hint">Showing {term}-yr rates · click to drill in</span>
        </div>
        <Suspense fallback={<p className="loading">Loading map…</p>}>
          <UsChoropleth index={states} term={term} loanAmount={loanAmount} />
        </Suspense>
        <p className="map-caption">
          Hover any colored state for today's rate + your estimated payment. Use the{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => setPanelOpen(true)}
          >
            state list panel
          </button>{" "}
          on the left for an alphabetical / search view.
        </p>
      </section>

      {/* FRED meta strip (moved below map) */}
      <div className="meta-row">
        <span>
          <b>FRED PMMS</b> · 15-yr <b>{fmtRate(latestUs15?.rate)}</b> · 30-yr{" "}
          <b>{fmtRate(latestUs30?.rate)}</b> ({latestUs30?.month})
        </span>
        <span className="dot">·</span>
        <span>
          Updated{" "}
          {new Date(built_at_utc).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </span>
      </div>

      {/* About / stats (moved below map) */}
      <section className="hero hero-soft">
        <p className="hero-eyebrow hero-eyebrow-soft">U.S. mortgage rate dashboard</p>
        <h2 className="hero-subtitle">
          Quoted rates meet <span className="accent">closed-loan reality</span>.
        </h2>
        <p className="hero-sub">
          For each U.S. state and county, compare today's quoted rates with the actual HMDA 2024
          closed-loan distribution. Daily auto-refresh from{" "}
          <a href="https://fred.stlouisfed.org">FRED</a>,{" "}
          <a href="https://www.bankrate.com">Bankrate</a>, and{" "}
          <a href="https://www.mortgagenewsdaily.com">Mortgage News Daily</a>.
        </p>
        <div className="hero-stats">
          <div className="stat-card">
            <div className="stat-value">{states.length}</div>
            <div className="stat-label">states + DC bundled</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">3,141</div>
            <div className="stat-label">counties partitioned</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">
              ~7<span className="stat-value-sub">M</span>
            </div>
            <div className="stat-label">HMDA originations</div>
          </div>
          <div className="stat-card accent">
            <div className="stat-value">{states.filter((s) => s.latest_30 != null).length}</div>
            <div className="stat-label">daily-refreshing</div>
          </div>
        </div>
      </section>

      <div className="notes">
        <p>
          <b>Why this exists.</b> Bankrate and Zillow show today's quoted rates per state but no
          closed-loan reality. The FFIEC HMDA Data Browser shows actual closings per county but no
          quote comparison and no time series. The unique value here is combining both — see the{" "}
          <Link to="/methodology">methodology</Link> for source detail and limitations.
        </p>
        <p>
          See the <a href="https://github.com/akanchibotla/Mortgage_Loan_Dashboard">repo</a> and{" "}
          <a href="https://github.com/akanchibotla/Mortgage_Loan_Dashboard/blob/main/ROADMAP.md">
            roadmap
          </a>{" "}
          on GitHub.
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
            <p className="side-panel-sub">{term}-yr rate · click to drill in</p>
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
