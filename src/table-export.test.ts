// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { createCsv, createExcelWorkbook, downloadTable } from "./table-export"

afterEach(() => vi.restoreAllMocks())

describe("table exports", () => {
  it("creates a UTF-8 CSV with escaped operational data", () => {
    const csv = createCsv([
      ["Item", "Available", "Notes"],
      ["Meal boxes", 120, "Ready, packed"],
      ["Water", 75.5, "Store \"A\""],
    ])

    expect(csv).toBe(
      '\uFEFFItem,Available,Notes\r\nMeal boxes,120,"Ready, packed"\r\nWater,75.5,"Store ""A"""',
    )
  })

  it("creates an Excel-compatible workbook with text and numeric cells", () => {
    const workbook = createExcelWorkbook("Stock & Supply", [
      ["Item", "Available"],
      ["Water <bottles>", 75.5],
    ])

    expect(workbook).toContain('ss:Name="Stock &amp; Supply"')
    expect(workbook).toContain('<Data ss:Type="String">Water &lt;bottles&gt;</Data>')
    expect(workbook).toContain('<Data ss:Type="Number">75.5</Data>')
  })

  it("downloads the selected format with a readable filename", () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:export") })
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() })
    let downloadedAs = ""
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () { downloadedAs = this.download })

    downloadTable("Orders & Deliveries", [["Order"], ["#12"]], "excel")

    expect(downloadedAs).toBe("orders-deliveries.xls")
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:export")
  })
})
