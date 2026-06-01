import { RateChart } from "./components/RateChart";
import { RateTable } from "./components/RateTable";
import pmms15 from "./data/pmms_15yr_monthly.json";
import pmms30 from "./data/pmms_30yr_monthly.json";
import nc15 from "./data/nc_bankrate_15yr_monthly.json";
import nc30 from "./data/nc_bankrate_30yr_monthly.json";
import mnd15 from "./data/mnd_nc_15yr_monthly.json";
import mnd30 from "./data/mnd_nc_30yr_monthly.json";
import hmda from "./data/hmda_nc_2024_15yr_summary.json";
import type {
  HmdaSummary,
  MonthlyRate,
  NcMonthlySnapshot,
} from "./types";

const us15 = pmms15 as MonthlyRate[];
const us30 = pmms30 as MonthlyRate[];
const ncSeries15 = nc15 as NcMonthlySnapshot[];
const ncSeries30 = nc30 as NcMonthlySnapshot[];
const mndSeries15 = mnd15 as NcMonthlySnapshot[];
const mndSeries30 = mnd30 as NcMonthlySnapshot[];
const hmda15 = hmda as HmdaSummary;

export default function App() {
  return (
    <>
      <h1>15- and 30-year fixed mortgage rates — North Carolina vs U.S.</h1>
      <p className="sub">
        Monthly, Jun 2024 – May 2026.{" "}
        <span className="badge">U.S.</span> Freddie Mac PMMS via FRED, monthly mean of weekly observations.{" "}
        <span className="badge">NC</span> Bankrate NC purchase rate (Wayback monthly + live trailing month).{" "}
        <span className="badge">NC today</span> Mortgage News Daily NC (most recent business day).{" "}
        <span className="badge">HMDA 2024 NC ref</span> origination distribution band, 15-yr only.
      </p>

      <section className="section">
        <h2>15-year fixed</h2>
        <RateChart
          usData={us15}
          ncData={ncSeries15}
          mndData={mndSeries15}
          hmdaBand={hmda15}
          title="15-year fixed mortgage rate — NC vs U.S."
          usLabel="U.S. 15-yr FRM (FRED MORTGAGE15US, monthly mean)"
          ncLabel="NC 15-yr fixed (Bankrate NC, monthly)"
          mndLabel="NC 15-yr fixed (Mortgage News Daily, monthly)"
          yMin={5.0}
          yMax={7.0}
        />
        <RateTable usData={us15} ncData={ncSeries15} />
      </section>

      <section className="section">
        <h2>30-year fixed</h2>
        <RateChart
          usData={us30}
          ncData={ncSeries30}
          mndData={mndSeries30}
          title="30-year fixed mortgage rate — NC vs U.S."
          usLabel="U.S. 30-yr FRM (FRED MORTGAGE30US, monthly mean)"
          ncLabel="NC 30-yr fixed (Bankrate NC, monthly)"
          mndLabel="NC 30-yr fixed (Mortgage News Daily, monthly)"
          yMin={5.5}
          yMax={7.5}
        />
        <RateTable usData={us30} ncData={ncSeries30} />
      </section>

      <div className="notes">
        <b>Sources &amp; method</b>
        <ul>
          <li>
            <b>U.S. line</b> —{" "}
            <a href="https://fred.stlouisfed.org/series/MORTGAGE15US">FRED MORTGAGE15US</a> and{" "}
            <a href="https://fred.stlouisfed.org/series/MORTGAGE30US">MORTGAGE30US</a>, which mirror
            Freddie Mac's <a href="https://www.freddiemac.com/pmms">PMMS</a> weekly survey. Each
            plotted month is the simple mean of the weekly observations in that calendar month.
          </li>
          <li>
            <b>NC line</b> — the headline 15-Year / 30-Year Fixed Rate purchase value from{" "}
            <a href="https://www.bankrate.com/mortgages/mortgage-rates/north-carolina/">
              Bankrate's North Carolina page
            </a>
            , captured from <a href="https://web.archive.org/">Internet Archive</a> snapshots.
            Unarchived months render as gaps rather than interpolated. The 15-yr 2026-04 point uses
            Experian's NC reference (prior-month). The trailing 2026-05 points come from today's
            rendered Bankrate page — that page hydrates rate values via client-side JS, so a
            static HTTP fetch sees 0.00% placeholders; the values are entered manually in{" "}
            <code>scripts/reconcile_nc.py</code>. Markers below each chart distinguish Wayback
            archived points (filled diamonds), the live Bankrate point (open circle), and the
            Experian fallback (cross).
          </li>
          <li>
            <b>Mortgage News Daily NC (today, triangle)</b> — daily NC rate from{" "}
            <a href="https://www.mortgagenewsdaily.com/mortgage-rates/north-carolina">
              mortgagenewsdaily.com
            </a>
            . Single-day cross-check; gap between MND and Bankrate today gives a sense of intra-source
            methodology noise.
          </li>
          <li>
            <b>HMDA 2024 reference band</b> (15-yr chart only) —{" "}
            <a href="https://ffiec.cfpb.gov/data-browser/">FFIEC HMDA 2024 public LAR</a>, filtered
            to NC + home purchase + originated + loan_term=180. The outer (lighter) box spans the
            p10–p90 rate range from the closed-loan distribution (n={hmda15.n_loans.toLocaleString()});
            the inner (darker) box spans p25–p75. The dashed lines are the simple mean and
            loan-amount-weighted mean. HMDA has no month-of-origination field in the public LAR, so
            this is one annual figure, not a monthly series.
          </li>
          <li>
            Bankrate's NC averages, Freddie's PMMS, and MND use different methodologies (lender
            survey panel vs. weighted lock-flow average vs. lender-aggregate daily quote), so they
            will not match exactly even on the same date. The wider HMDA band shows how thinly the
            mean-of-survey numbers describe what NC borrowers actually closed in 2024.
          </li>
          <li>
            No commercial state-level historical monthly series exists in the free/public domain.
            Curinos LLC (which Experian uses) is paid/restricted. The Bankrate Wayback approach +
            MND cross-check is the most faithful free state-level proxy available.
          </li>
        </ul>
      </div>
    </>
  );
}
