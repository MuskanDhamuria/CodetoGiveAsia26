export type ExportCell = string | number | boolean | null | undefined
export type ExportRows = ExportCell[][]

function csvCell(value: ExportCell) {
  const text = value === null || value === undefined ? "" : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function createCsv(rows: ExportRows) {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`
}

function xml(value: ExportCell) {
  return (value === null || value === undefined ? "" : String(value))
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

export function createExcelWorkbook(sheetName: string, rows: ExportRows) {
  const safeSheetName = sheetName.replace(/[\\/:*?[\]]/g, " ").slice(0, 31) || "Export"
  const body = rows.map((row, rowIndex) => `<Row>${row.map((cell) => {
    const type = typeof cell === "number" && Number.isFinite(cell) ? "Number" : "String"
    const style = rowIndex === 0 ? ' ss:StyleID="Header"' : ""
    return `<Cell${style}><Data ss:Type="${type}">${xml(cell)}</Data></Cell>`
  }).join("")}</Row>`).join("")

  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#E8F1EB" ss:Pattern="Solid"/></Style></Styles><Worksheet ss:Name="${xml(safeSheetName)}"><Table>${body}</Table></Worksheet></Workbook>`
}

export function downloadTable(name: string, rows: ExportRows, format: "csv" | "excel") {
  const baseName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "export"
  const isCsv = format === "csv"
  const contents = isCsv ? createCsv(rows) : createExcelWorkbook(name, rows)
  const blob = new Blob([contents], { type: isCsv ? "text/csv;charset=utf-8" : "application/vnd.ms-excel;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${baseName}.${isCsv ? "csv" : "xls"}`
  link.click()
  URL.revokeObjectURL(url)
}
