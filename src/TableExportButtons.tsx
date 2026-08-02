import { downloadTable, type ExportRows } from "./table-export"

export default function TableExportButtons({ name, rows }: { name: string; rows: ExportRows }) {
  const disabled = rows.length <= 1

  return <div aria-label={`Export ${name}`} className="table-export-actions" role="group">
    <span>Export</span>
    <button aria-label={`Export ${name} as CSV`} disabled={disabled} onClick={() => downloadTable(name, rows, "csv")}>CSV</button>
    <button aria-label={`Export ${name} as Excel`} disabled={disabled} onClick={() => downloadTable(name, rows, "excel")}>Excel</button>
  </div>
}
