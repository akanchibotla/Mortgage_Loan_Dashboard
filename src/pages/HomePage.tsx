import { lazy, Suspense, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadPmms, loadStatesIndex } from "../lib/loadStateData";
import { usePageMeta, BASE_TITLE } from "../lib/usePageMeta";
import { fmtMoney, fmtRate, monthlyPayment } from "../lib/payment";
import { useTermPreference } from "../lib/useTermPreference";
import { useCalculator } from "../lib/useCalculator";

const UsChoropleth = lazy(() =>
  import("../components/UsChoropleth").then((m) => ({ default: m.UsChoropleth })),
);
const AmortPanel = lazy(() =>
  import("../components/AmortPanel").then((m) => ({ default: m.AmortPanel })),
);

const STEP = 5_000;
const SHIFT_STEP = 50_000;
const MIN_AMOUNT = 25_000;
const MAX_AMOUNT = 5_000_000;

const RATE_STEP = 0.05;
const RATE_SHIFT_STEP = 0.25;
const MIN_RATE = 0.5;
const MAX_RATE = 25;

function clampLoan(v: number): number {
  if (!Number.isFinite(v)) return MIN_AMOUNT;
  return Math.max(MIN_AMOUNT, Math.min(MAX_AMOUNT, Math.round(v / STEP) * STEP));
}

function clampRate(v: number): number {
  if (!Number.isFinite(v)) return MIN_RATE;
  return Math.max(MIN_RATE, Math.min(MAX_RATE, +v.toFixed(3)));
}

export default function HomePage() {
  const { states, built_at_utc } = loadStatesIndex();
  const { pmms15, pmms30 } = loadPmms();
  const latestUs15 = pmms15.at(-1);
  const latestUs30 = pmms30.at(-1);
  const [term, setTerm] = useTermPreference();
  const { loanAmount, setLoanAmount, rateText, setRateText } = useCalculator();
  const [selectedStateSlug, setSelectedStateSlug] = useState<string>(""); // "" = national
  const [amortOpen, setAmortOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [filter, setFilter] = useState("");
  usePageMeta({ title: BASE_TITLE });

  const filteredStates = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return states;
    return states.filter(
      (s) => s.name.toLowerCase().includes(f) || s.postal.toLowerCase().includes(f),
    );
  }, [states, filter]);

  const pmmsRate = (term === 15 ? latestUs15?.rate : latestUs30?.rate) ?? null;
  const usMonth = term === 15 ? latestUs15?.month : latestUs30?.month;
  const selectedState = useMemo(
    () => (selectedStateSlug ? states.find((s) => s.slug === selectedStateSlug) ?? null : null),
    [selectedStateSlug, states],
  );
  const anchorRate = useMemo<number | null>(() => {
    if (selectedState) {
      const v = term === 15 ? selectedState.latest_15 : selectedState.latest_30;
      return v ?? pmmsRate ?? null;
    }
    return pmmsRate;
  }, [selectedState, term, pmmsRate]);
  const stateAnchorMissing =
    selectedState != null && (term === 15 ? selectedState.latest_15 : selectedState.latest_30) == null;
  const anchorMonth = selectedState
    ? selectedState.latest_30_month ?? selectedState.latest_15_month ?? null
    : usMonth ?? null;
  const customRate = useMemo<number | null>(() => {
    if (rateText === "") return null;
    const v = parseFloat(rateText);
    return Number.isFinite(v) ? v : null;
  }, [rateText]);
  const effectiveRate = customRate ?? anchorRate;
  const effectivePI =
    effectiveRate != null ? monthlyPayment(loanAmount, effectiveRate, term) : null;
  const totalPaid = effectivePI != null && term > 0 ? effectivePI * term * 12 : null;
  const totalInterest = totalPaid != null ? Math.max(0, totalPaid - loanAmount) : null;
  const principalPct =
    totalPaid != null && totalPaid > 0
      ? Math.max(0, Math.min(100, (loanAmount / totalPaid) * 100))
      : 0;
  const interestPct = 100 - principalPct;
  const rateInputValue =
    rateText === "" && anchorRate != null ? anchorRate.toFixed(2) : rateText;
  const isCustomRate = customRate != null && anchorRate != null && customRate !== anchorRate;
  const sortedStates = useMemo(
    () => [...states].sort((a, b) => a.name.localeCompare(b.name)),
    [states],
  );

  function bumpRate(dir: -1 | 1, e: React.MouseEvent) {
    const step = e.shiftKey ? RATE_SHIFT_STEP : RATE_STEP;
    const base = effectiveRate ?? 6;
    setRateText(clampRate(base + dir * step).toFixed(2));
  }

  return (
    <>
      <StatePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        filteredStates={filteredStates}
        term={term}
        filter={filter}
        onFilter={setFilter}
      />
      <button
        type="button"
        className={`side-panel-toggle ${panelOpen ? "open state-list-toggle-open" : ""}`}
        onClick={() => setPanelOpen((v) => !v)}
        aria-label={panelOpen ? "Hide state list" : "Open state list"}
        title={panelOpen ? "Hide all states" : "Show all states"}
      >
        <span className="hamburger">{panelOpen ? "✕" : "☰"}</span>
        <span className="toggle-label">{panelOpen ? "Hide states" : "All states"}</span>
      </button>

      {/* CALCULATOR HERO — interactive controls that drive the map below */}
      <section className="hero hero-calc">
        <p className="hero-eyebrow">Mortgage calculator</p>
        <h1 className="hero-title">
          Your loan, <span className="accent">every state</span>.
        </h1>

        <div className="calc-inputs">
          <div className="calc-input">
            <div className="calc-input-section">
              <span className="calc-input-label">Loan amount</span>
              <div className="amount-wrap">
                <button
                  type="button"
                  className="step-btn"
                  onClick={(e) =>
                    setLoanAmount((v) => clampLoan(v - (e.shiftKey ? SHIFT_STEP : STEP)))
                  }
                  disabled={loanAmount <= MIN_AMOUNT}
                  title="Decrease by $5K (Shift+click for $50K)"
                  aria-label="Decrease loan amount"
                >
                  −
                </button>
                <div className="amount-input-wrap">
                  <span className="amount-prefix">$</span>
                  <input
                    type="number"
                    min={MIN_AMOUNT}
                    max={MAX_AMOUNT}
                    step={STEP}
                    value={loanAmount}
                    onChange={(e) => setLoanAmount(clampLoan(Number(e.target.value) || 0))}
                  />
                </div>
                <button
                  type="button"
                  className="step-btn"
                  onClick={(e) =>
                    setLoanAmount((v) => clampLoan(v + (e.shiftKey ? SHIFT_STEP : STEP)))
                  }
                  disabled={loanAmount >= MAX_AMOUNT}
                  title="Increase by $5K (Shift+click for $50K)"
                  aria-label="Increase loan amount"
                >
                  +
                </button>
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
            </div>
            <div className="calc-input-section">
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
            </div>
          </div>

          <div className="calc-output-card">
            <div className="calc-out-header">
              <div className="calc-out-label">Your rate</div>
              <select
                className="rate-source-select"
                value={selectedStateSlug}
                onChange={(e) => {
                  setSelectedStateSlug(e.target.value);
                  setRateText(""); // clear override so new anchor shows
                }}
                aria-label="Rate source"
                title="Use today's Bankrate rate from this state instead of the national average"
              >
                <option value="">
                  U.S. National{pmmsRate != null ? ` · ${pmmsRate.toFixed(2)}%` : ""}
                </option>
                {sortedStates.map((s) => {
                  const r = term === 30 ? s.latest_30 : s.latest_15;
                  return (
                    <option key={s.slug} value={s.slug}>
                      {s.name} · {r != null ? `${r.toFixed(2)}%` : "—"}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="calc-out-row">
              <div className="rate-stepper">
                <button
                  type="button"
                  className="step-btn step-btn-sm"
                  onClick={(e) => bumpRate(-1, e)}
                  disabled={effectiveRate != null && effectiveRate <= MIN_RATE}
                  title="Decrease by 0.05% (Shift+click for 0.25%)"
                  aria-label="Decrease rate"
                >
                  −
                </button>
                <input
                  type="number"
                  className="rate-input"
                  min={MIN_RATE}
                  max={MAX_RATE}
                  step={RATE_STEP}
                  value={rateInputValue}
                  onChange={(e) => setRateText(e.target.value)}
                  onBlur={() => {
                    if (customRate != null) setRateText(clampRate(customRate).toFixed(2));
                  }}
                  aria-label="Interest rate (percent)"
                />
                <span className="rate-suffix">%</span>
                <button
                  type="button"
                  className="step-btn step-btn-sm"
                  onClick={(e) => bumpRate(1, e)}
                  disabled={effectiveRate != null && effectiveRate >= MAX_RATE}
                  title="Increase by 0.05% (Shift+click for 0.25%)"
                  aria-label="Increase rate"
                >
                  +
                </button>
              </div>
              <span className="calc-out-arrow">→</span>
              <span className="calc-out-payment">{fmtMoney(effectivePI)}/mo</span>
            </div>
            {totalPaid != null && totalInterest != null && totalPaid > 0 && (
              <div className="amort" title={`Amortized over ${term} years at the rate shown`}>
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
            <div className="calc-out-hint">
              {anchorRate == null ? (
                <span>no rate data bundled for {selectedState?.name ?? "this term"}</span>
              ) : isCustomRate ? (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setRateText("")}
                  title={
                    selectedState
                      ? `Reset to Bankrate ${selectedState.postal} ${term}-yr ${anchorRate.toFixed(2)}%`
                      : `Reset to FRED PMMS ${term}-yr ${anchorRate.toFixed(2)}%`
                  }
                >
                  ↺ Reset to{" "}
                  {selectedState
                    ? `Bankrate ${selectedState.postal} ${anchorRate.toFixed(2)}%`
                    : `FRED PMMS ${anchorRate.toFixed(2)}%`}
                </button>
              ) : selectedState ? (
                <span>
                  Bankrate {selectedState.postal} {term}-yr {anchorRate.toFixed(2)}% today
                  {stateAnchorMissing && (
                    <span className="hint-note">
                      {" "}
                      (term not bundled · using national fallback)
                    </span>
                  )}
                </span>
              ) : (
                <span>
                  matches FRED PMMS {term}-yr {anchorRate.toFixed(2)}%
                  {anchorMonth ? ` (${anchorMonth})` : ""}
                </span>
              )}
            </div>
            <div className="calc-out-hint">↓ Hover any state below for state-specific numbers</div>
          </div>
        </div>
      </section>

      {/* AMORTIZATION DISCLOSURE — collapsed by default */}
      {effectiveRate != null && effectivePI != null && (
        <details
          className="amort-details"
          open={amortOpen}
          onToggle={(e) => setAmortOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>
            <span className="amort-summary-chevron" aria-hidden="true">
              ▸
            </span>
            <span className="amort-summary-text">
              {amortOpen ? "Hide" : "Show"} month-by-month amortization schedule
            </span>
            <span className="amort-summary-meta">
              {term * 12} months · {fmtMoney(effectivePI)}/mo
            </span>
          </summary>
          {amortOpen && (
            <Suspense fallback={<p className="loading">Building schedule…</p>}>
              <AmortPanel
                loanAmount={loanAmount}
                annualRatePct={effectiveRate}
                termYears={term}
              />
            </Suspense>
          )}
        </details>
      )}

      {/* MAP */}
      <section className="section">
        <div className="map-controls map-controls-flat">
          <h2>Pick a state</h2>
          <span className="map-controls-hint">Showing {term}-yr rates · click to drill in</span>
        </div>
        <Suspense fallback={<p className="loading">Loading map…</p>}>
          <UsChoropleth
            index={states}
            term={term}
            loanAmount={loanAmount}
            selectedSlug={selectedStateSlug}
          />
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

    </>
  );
}

interface PanelProps {
  open: boolean;
  onClose: () => void;
  filteredStates: ReturnType<typeof loadStatesIndex>["states"];
  term: 15 | 30;
  filter: string;
  onFilter: (v: string) => void;
}

function StatePanel({
  open,
  onClose,
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
          <div className="side-panel-titles">
            <p className="side-panel-eyebrow">Browse</p>
            <h3 className="side-panel-h3">All states</h3>
            <p className="side-panel-sub">
              Showing <b>{term}-year</b> quoted rate · click any state to drill in
            </p>
          </div>
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
