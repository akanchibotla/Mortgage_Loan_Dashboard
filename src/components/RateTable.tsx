import type { MonthlyRate, NcMonthlySnapshot } from "../types";

interface Props {
  usData: MonthlyRate[];
  ncData: NcMonthlySnapshot[];
}

const EMDASH = "—";

export function RateTable({ usData, ncData }: Props) {
  const usByMonth = new Map(usData.map((p) => [p.month, p.rate]));

  return (
    <table>
      <thead>
        <tr>
          <th>Month</th>
          <th>U.S. (PMMS)</th>
          <th>NC (Bankrate)</th>
          <th>Spread (bp)</th>
        </tr>
      </thead>
      <tbody>
        {ncData.map((p) => {
          const us = usByMonth.get(p.m);
          const usCell = us != null ? `${us.toFixed(2)}%` : EMDASH;
          const ncCell = p.rate != null ? `${p.rate.toFixed(2)}%` : EMDASH;
          const spreadCell =
            p.rate != null && us != null ? `${Math.round((p.rate - us) * 100)} bp` : EMDASH;
          return (
            <tr key={p.m}>
              <td>{p.m}</td>
              <td>{usCell}</td>
              <td>{ncCell}</td>
              <td>{spreadCell}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
