import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("intermediate-width navbar", () => {
  it("keeps navigation controls on one scrollable row", () => {
    const styles = readFileSync("src/index.css", "utf8")

    expect(styles).toMatch(
      /@media\s*\(min-width:\s*811px\)\s*and\s*\(max-width:\s*1600px\)[\s\S]*\.navbar\s*\{[^}]*overflow-x:\s*auto/s,
    )
    expect(styles).toMatch(
      /@media\s*\(min-width:\s*811px\)\s*and\s*\(max-width:\s*1600px\)[\s\S]*\.navbar-inner\s*\{[^}]*min-width:\s*max-content/s,
    )
    expect(styles).toMatch(
      /@media\s*\(min-width:\s*811px\)\s*and\s*\(max-width:\s*1600px\)[\s\S]*\.nav-links\s*\{[^}]*flex-wrap:\s*nowrap/s,
    )
    expect(styles).toMatch(
      /@media\s*\(min-width:\s*811px\)\s*and\s*\(max-width:\s*1600px\)[\s\S]*\.nav-links\s*\{[^}]*white-space:\s*nowrap/s,
    )
  })
})
