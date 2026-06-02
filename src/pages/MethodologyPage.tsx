import { Link } from "react-router-dom";
import { usePageMeta } from "../lib/usePageMeta";

export default function MethodologyPage() {
  usePageMeta({
    title: "Methodology",
    description:
      "How the mortgage rate dashboard is built: where the rates come from, how HMDA data is processed, what the demographic and county breakdowns mean, and what the limitations are.",
  });
  return (
    <>
      <h1>Methodology &amp; sources</h1>
      <p className="sub">
        <b>Why this exists.</b>{" "}
        <a href="https://www.bankrate.com/mortgages/mortgage-rates/">Bankrate</a> and Zillow show
        today's quoted rates per state but no closed-loan reality. The{" "}
        <a href="https://ffiec.cfpb.gov/data-browser/">FFIEC HMDA Data Browser</a> shows actual
        closings per county but no quote comparison and no time series. This dashboard combines
        both — today's quoted rates against last year's HMDA closing distribution, per state and
        per county, with monthly history for context.
      </p>

      <section className="section">
        <h2>Data sources</h2>
        <ul>
          <li>
            <b>U.S. baseline (15-yr and 30-yr fixed)</b> —{" "}
            <a href="https://fred.stlouisfed.org/series/MORTGAGE15US">FRED MORTGAGE15US</a> and{" "}
            <a href="https://fred.stlouisfed.org/series/MORTGAGE30US">MORTGAGE30US</a>, which mirror
            Freddie Mac's <a href="https://www.freddiemac.com/pmms">Primary Mortgage Market Survey</a>{" "}
            (PMMS). Weekly observations published Thursdays; this dashboard aggregates to monthly
            mean.
          </li>
          <li>
            <b>State-level "today" rates</b> —{" "}
            <a href="https://www.bankrate.com/mortgages/mortgage-rates/">Bankrate's per-state pages</a>
            , scraped via headless Chromium (the page hydrates rates client-side, so a static HTTP
            fetch sees only placeholder zeros). Also{" "}
            <a href="https://www.mortgagenewsdaily.com/mortgage-rates">
              Mortgage News Daily's per-state pages
            </a>{" "}
            via simple HTTP (their values are embedded in raw HTML).
          </li>
          <li>
            <b>State-level historical rates (Bankrate)</b> — monthly snapshots of each state's
            Bankrate page captured by the{" "}
            <a href="https://web.archive.org/">Internet Archive's Wayback Machine</a>. We query the
            CDX index for the closest snapshot to mid-month and extract the rate-table value. Coverage
            depends on how often Wayback crawled each state (varies from ~11 to ~20 months out of 25).
          </li>
          <li>
            <b>Closed-loan distributions (HMDA)</b> — the{" "}
            <a href="https://ffiec.cfpb.gov/data-browser/">FFIEC HMDA Data Browser</a> 2024 LAR
            (Loan Application Register), filtered to <code>action_taken=1</code> (originated),{" "}
            <code>loan_purpose=1</code> (home purchase), and conventional first-lien purchase. ~7
            million originations across 3,141 U.S. counties.
          </li>
        </ul>
      </section>

      <section className="section">
        <h2>How HMDA distributions are computed</h2>
        <p>
          For each state (and each county within), we group HMDA originations by loan term (15-yr ={" "}
          <code>loan_term=180</code>, 30-yr = <code>loan_term=360</code>) and compute:
        </p>
        <ul>
          <li><b>n_loans</b>: count of clean originations in the bucket.</li>
          <li>
            <b>Simple mean</b>: arithmetic mean of <code>interest_rate</code> across all loans.
          </li>
          <li>
            <b>Loan-amount-weighted mean</b>: mean weighted by <code>loan_amount</code>. Larger loans
            count more.
          </li>
          <li>
            <b>p10–p90</b>: 10th to 90th percentile of the rate distribution (unweighted).
          </li>
          <li><b>p25–p75</b>: interquartile range (unweighted).</li>
        </ul>
        <p>
          Counties with &lt;30 originations for a term are flagged "low n" — treat their percentiles
          as noisy.
        </p>
      </section>

      <section className="section">
        <h2>Demographic breakdowns: what they mean (and don't)</h2>
        <p>
          For each state we also compute per-bucket distributions across four dimensions: race
          (HMDA <code>derived_race</code>), ethnicity (<code>derived_ethnicity</code>), sex (
          <code>derived_sex</code>), and loan-amount bracket. Each bucket gets the same stats
          (n, mean, percentiles).
        </p>
        <p>
          <b>Important interpretation note.</b> When you see "Black borrowers got an X bp lower
          mean rate than White borrowers in this state," that's a population-level observation, not
          a lender-bias finding. The difference reflects a mix of factors:
        </p>
        <ul>
          <li>
            <b>Loan program selection</b> — Black borrowers in 2024 used FHA loans (which typically
            have lower rates) at higher rates than the general population.
          </li>
          <li>
            <b>Loan-size composition</b> — Different demographic groups have different median loan
            sizes, and rate varies with loan size in a U-curve (small loans pay more, sweet spot is
            $350–500K).
          </li>
          <li>
            <b>Geographic composition</b> — Demographic groups cluster geographically, and rates
            vary by region.
          </li>
          <li>
            <b>Credit profile</b> — HMDA public LAR doesn't include credit scores, but they're a
            major driver of rate.
          </li>
        </ul>
        <p>
          A true fair-lending analysis would control for these factors and compare borrowers with
          identical applications. This dashboard shows the raw aggregates — useful for spotting
          patterns and asking better questions, not for drawing causal conclusions.
        </p>
      </section>

      <section className="section">
        <h2>Refresh cadence</h2>
        <ul>
          <li>
            <b>FRED PMMS</b> — fetched daily by GitHub Actions at 12:00 UTC. Freddie publishes
            weekly on Thursdays.
          </li>
          <li>
            <b>Bankrate state pages</b> — fetched daily for{" "}
            <Link to="/">the bundled states</Link>. Other states are added on demand once their
            Wayback historical backfill completes.
          </li>
          <li>
            <b>Mortgage News Daily state pages</b> — fetched daily. Their values are
            close-of-business each weekday.
          </li>
          <li>
            <b>HMDA</b> — annual. The 2024 LAR is what's used today. 2025 LAR is expected mid-2026.
          </li>
        </ul>
      </section>

      <section className="section">
        <h2>Limitations &amp; what we don't do</h2>
        <ul>
          <li>No intraday data. Rates can move 25 bp between morning and afternoon; this dashboard is daily-resolution.</li>
          <li>No ARM, refinance, FHA-specific, or VA-specific breakdowns yet. All views are 15-yr or 30-yr fixed conventional purchase.</li>
          <li>HMDA public LAR strips some fields for privacy (e.g., the exact origination date and credit score). All percentiles are calendar-year-2024 aggregates.</li>
          <li>Bankrate's quoted rates are a panel survey, not actual closed-loan rates. They typically run ~10–30 bp above or below HMDA closings depending on point/credit dynamics.</li>
          <li>The three rate sources (FRED PMMS lender survey, Bankrate lender-aggregate quote, MND lock-flow) use different methodologies and typically disagree by ~10–30 bp even on the same date. Don't expect the three lines on each state chart to agree.</li>
          <li>The "today" Bankrate value is whatever the rendered page shows at refresh time. Their methodology can shift; we capture what's there.</li>
          <li>State boundaries on the choropleth match the U.S. Census 2024 cartographic file. Some FIPS edge cases (Connecticut planning regions, Virginia independent cities) may render unexpectedly.</li>
        </ul>
      </section>

      <section className="section">
        <h2>Open source</h2>
        <p>
          Everything is on GitHub at{" "}
          <a href="https://github.com/akanchibotla/Mortgage_Loan_Dashboard">
            akanchibotla/Mortgage_Loan_Dashboard
          </a>
          . The scripts are Python; the dashboard is React + TypeScript on Vite. PRs and issues
          welcome.
        </p>
      </section>
    </>
  );
}
