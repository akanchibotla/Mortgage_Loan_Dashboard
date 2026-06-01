import { Link, useParams } from "react-router-dom";
import { RateChart } from "../components/RateChart";
import { RateTable } from "../components/RateTable";
import { loadPmms, loadStateData } from "../lib/loadStateData";

export default function StateDashboard() {
  const { slug = "" } = useParams<{ slug: string }>();
  const data = loadStateData(slug);
  const { pmms15, pmms30 } = loadPmms();

  if (!data.meta) {
    return (
      <div>
        <p>
          <Link to="/">&larr; Back to home</Link>
        </p>
        <h1>State not found</h1>
        <p>No data was bundled for slug <code>{slug}</code>.</p>
      </div>
    );
  }

  const name = data.meta.name;
  const hasMnd = data.mnd15?.some((p) => p.rate != null) || data.mnd30?.some((p) => p.rate != null);

  return (
    <>
      <p className="breadcrumb">
        <Link to="/">&larr; All states</Link>
      </p>
      <h1>{name} mortgage rates — vs U.S.</h1>
      <p className="sub">
        <span className="badge">U.S.</span> Freddie Mac PMMS via FRED, monthly mean.{" "}
        <span className="badge">{data.meta.postal}</span> Bankrate (Wayback + live).{" "}
        {hasMnd && <><span className="badge">{data.meta.postal} MND</span> Mortgage News Daily.{" "}</>}
        {data.hmda15 && <><span className="badge">HMDA 2024 ref</span> 15-yr origination band.</>}
      </p>

      <section className="section">
        <h2>15-year fixed</h2>
        <RateChart
          usData={pmms15}
          ncData={data.bankrate15 ?? []}
          mndData={data.mnd15 ?? undefined}
          hmdaBand={data.hmda15}
          title={`15-year fixed mortgage rate — ${name} vs U.S.`}
          usLabel="U.S. 15-yr FRM (FRED MORTGAGE15US, monthly mean)"
          ncLabel={`${name} 15-yr fixed (Bankrate, monthly)`}
          mndLabel={`${name} 15-yr fixed (Mortgage News Daily, monthly)`}
          yMin={4.5}
          yMax={7.5}
        />
        {data.bankrate15 && <RateTable usData={pmms15} ncData={data.bankrate15} />}
      </section>

      <section className="section">
        <h2>30-year fixed</h2>
        <RateChart
          usData={pmms30}
          ncData={data.bankrate30 ?? []}
          mndData={data.mnd30 ?? undefined}
          title={`30-year fixed mortgage rate — ${name} vs U.S.`}
          usLabel="U.S. 30-yr FRM (FRED MORTGAGE30US, monthly mean)"
          ncLabel={`${name} 30-yr fixed (Bankrate, monthly)`}
          mndLabel={`${name} 30-yr fixed (Mortgage News Daily, monthly)`}
          yMin={5.5}
          yMax={7.5}
        />
        {data.bankrate30 && <RateTable usData={pmms30} ncData={data.bankrate30} />}
      </section>

      <div className="notes">
        <b>Sources &amp; method</b>
        <ul>
          <li>
            <b>U.S. line</b> — <a href="https://fred.stlouisfed.org/series/MORTGAGE15US">FRED MORTGAGE15US</a> /{" "}
            <a href="https://fred.stlouisfed.org/series/MORTGAGE30US">MORTGAGE30US</a>; monthly mean of weekly observations.
          </li>
          <li>
            <b>{name} line</b> — Bankrate {name} page; historical from{" "}
            <a href="https://web.archive.org/">Internet Archive</a> snapshots; trailing month from
            today's live page via headless Chromium. Months without Wayback or live coverage render as
            gaps rather than interpolated.
          </li>
          {hasMnd && (
            <li>
              <b>{name} MND</b> — daily NC rate from{" "}
              <a href={`https://www.mortgagenewsdaily.com/mortgage-rates/${slug}`}>Mortgage News Daily</a>;
              Wayback historical (sparse) + forward daily collection.
            </li>
          )}
          {data.hmda15 && (
            <li>
              <b>HMDA 2024 reference band</b> (15-yr only) —{" "}
              <a href="https://ffiec.cfpb.gov/data-browser/">FFIEC HMDA 2024 LAR</a>, filtered to {data.meta.postal}{" "}
              + home purchase + originated + loan_term=180. The outer band shows p10–p90
              ({data.hmda15.p10_pct.toFixed(2)}%–{data.hmda15.p90_pct.toFixed(2)}%); inner box p25–p75; dashed
              lines mark simple and amount-weighted mean. HMDA has no month field, so this is one annual figure.
            </li>
          )}
          <li>
            Different methodologies (lender survey vs. lock-flow vs. lender-aggregate quote) explain
            ~10–30 bp gaps even on the same date.
          </li>
        </ul>
      </div>
    </>
  );
}
