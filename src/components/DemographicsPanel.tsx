import { useState } from "react";
import type { DemographicBucket, HmdaDemographicsFile } from "../types";

interface Props {
  data: HmdaDemographicsFile;
  stateName: string;
}

type Dim = "race" | "ethnicity" | "sex" | "loan_amount";

const DIM_LABELS: Record<Dim, string> = {
  race: "Race",
  ethnicity: "Ethnicity",
  sex: "Sex",
  loan_amount: "Loan amount",
};

export function DemographicsPanel({ data, stateName }: Props) {
  const [term, setTerm] = useState<15 | 30>(30);
  const [dim, setDim] = useState<Dim>("race");

  const buckets = (term === 15 ? data.term_15 : data.term_30)[dim] ?? [];
  if (buckets.length === 0) return null;
  const visible = buckets.filter((b) => b.n_loans >= 30);
  const overall = visible.reduce(
    (acc, b) => acc + (b.simple_mean_pct ?? 0) * b.n_loans,
    0,
  ) / visible.reduce((acc, b) => acc + b.n_loans, 0);
  // y-axis: cluster around mean
  const minR = Math.min(...visible.map((b) => b.simple_mean_pct ?? overall)) - 0.05;
  const maxR = Math.max(...visible.map((b) => b.simple_mean_pct ?? overall)) + 0.05;
  const RANGE_LO = Math.min(4, minR);
  const RANGE_HI = Math.max(8, maxR);

  return (
    <section className="section">
      <div className="map-controls">
        <h2>{stateName} HMDA breakdowns — who got which rate?</h2>
        <div className="term-toggle">
          <button type="button" className={term === 15 ? "active" : ""} onClick={() => setTerm(15)}>
            15-year
          </button>
          <button type="button" className={term === 30 ? "active" : ""} onClick={() => setTerm(30)}>
            30-year
          </button>
        </div>
      </div>
      <p className="sub">
        2024 closed-loan distributions sliced by demographic dimensions (FFIEC HMDA public LAR).
        Bucket counts &lt;30 are hidden. Differences reflect a mix of credit profile, loan size,
        and program selection (FHA/VA vs. conventional) — not necessarily lender discrimination on
        identical applications.
      </p>
      <div className="dim-toggle">
        {(Object.keys(DIM_LABELS) as Dim[]).map((d) => (
          <button
            key={d}
            type="button"
            className={dim === d ? "active" : ""}
            onClick={() => setDim(d)}
          >
            {DIM_LABELS[d]}
          </button>
        ))}
      </div>
      <table className="demo-table">
        <thead>
          <tr>
            <th>Bucket</th>
            <th className="num">n loans</th>
            <th className="num">Mean</th>
            <th>Distribution</th>
            <th className="num">vs overall</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((b) => (
            <BucketRow key={b.bucket} b={b} rangeLo={RANGE_LO} rangeHi={RANGE_HI} overall={overall} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function BucketRow({
  b,
  rangeLo,
  rangeHi,
  overall,
}: {
  b: DemographicBucket;
  rangeLo: number;
  rangeHi: number;
  overall: number;
}) {
  const span = rangeHi - rangeLo;
  const pct = (v: number) => `${((v - rangeLo) / span) * 100}%`;
  const w = (a: number, b: number) => `${Math.max(0, ((b - a) / span) * 100)}%`;
  const mean = b.simple_mean_pct ?? overall;
  const delta = Math.round((mean - overall) * 100);
  return (
    <tr>
      <td>{b.bucket}</td>
      <td className="num">{b.n_loans.toLocaleString()}</td>
      <td className="num">{b.simple_mean_pct?.toFixed(2) ?? "—"}%</td>
      <td>
        {b.p10_pct != null && b.p90_pct != null && (
          <div className="dist-bar inline-dist">
            <div className="dist-track">
              <div
                className="dist-band-outer"
                style={{ left: pct(b.p10_pct), width: w(b.p10_pct, b.p90_pct) }}
              />
              {b.p25_pct != null && b.p75_pct != null && (
                <div
                  className="dist-band-inner"
                  style={{ left: pct(b.p25_pct), width: w(b.p25_pct, b.p75_pct) }}
                />
              )}
              {b.p50_pct != null && (
                <div className="dist-median" style={{ left: pct(b.p50_pct) }} />
              )}
              <div className="dist-market" style={{ left: pct(overall), opacity: 0.4 }} />
            </div>
          </div>
        )}
      </td>
      <td className={`num delta ${delta > 5 ? "delta-up" : delta < -5 ? "delta-down" : ""}`}>
        {delta === 0 ? "0 bp" : delta > 0 ? `+${delta} bp` : `${delta} bp`}
      </td>
    </tr>
  );
}
