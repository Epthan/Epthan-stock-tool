"use client";

import type { GroupRow } from "@/lib/breakdowns";

type Column = "count" | "winRate" | "averageReturn" | "averageDays" | "weight" | "realized" | "unrealized";
const pct = (value: number | null) => (value == null || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`);
const tone = (value: number | null) => (value == null || Math.abs(value) < 0.005 ? "" : value > 0 ? "pd-positive" : "pd-negative");

/** P&L by group with a diverging bar, plus the supporting statistics the caller chooses. */
export function BreakdownTable({ rows, columns, labels, money, label }: { rows: GroupRow[]; columns: Column[]; labels: Record<Column | "group" | "pnl", string>; money: (value: number) => string; label?: (key: string) => string }) {
  const signedMoney = (value: number) => `${value > 0.004 ? "+" : value < -0.004 ? "−" : ""}${money(Math.abs(value))}`;
  const max = Math.max(1e-9, ...rows.map((row) => Math.abs(row.pnl)));
  const cell = (row: GroupRow, column: Column) => {
    switch (column) {
      case "count": return String(row.count);
      case "winRate": return row.winRate == null ? "—" : `${row.winRate.toFixed(0)}%`;
      case "averageReturn": return pct(row.averageReturn);
      case "averageDays": return row.averageDays == null ? "—" : Math.round(row.averageDays).toString();
      case "weight": return row.weight == null ? "—" : `${row.weight.toFixed(1)}%`;
      case "realized": return signedMoney(row.realized);
      case "unrealized": return signedMoney(row.unrealized);
    }
  };
  return <div className="pd-table-scroll bd-table"><table>
    <thead><tr><th>{labels.group}</th><th className="bd-bar-head">{labels.pnl}</th>{columns.map((column) => <th key={column}>{labels[column]}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.key}>
      <td className="bd-key">{label ? label(row.key) : row.key}</td>
      <td className="bd-bar-cell"><span className="bd-bar"><span className={row.pnl >= 0 ? "is-up" : "is-down"} style={{ width: `${Math.abs(row.pnl) / max * 50}%`, [row.pnl >= 0 ? "left" : "right"]: "50%" }} /></span><strong className={tone(row.pnl)}>{signedMoney(row.pnl)}</strong></td>
      {columns.map((column) => <td key={column} className={column === "averageReturn" ? tone(row.averageReturn) : column === "realized" ? tone(row.realized) : column === "unrealized" ? tone(row.unrealized) : ""}>{cell(row, column)}</td>)}
    </tr>)}</tbody>
  </table></div>;
}
