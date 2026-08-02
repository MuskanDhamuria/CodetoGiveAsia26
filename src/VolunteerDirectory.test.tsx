import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("Volunteer directory mobile layout", () => {
  it("contains the wide volunteer list inside its own scroll region", () => {
    const styles = readFileSync("src/index.css", "utf8")

    expect(styles).toMatch(/\.volunteer-directory\s*\{[^}]*max-width:\s*100%/)
    expect(styles).toMatch(/\.crm-toolbar\s*\{[^}]*min-width:\s*0/)
    expect(styles).toMatch(/\.search-field[\s\S]*min-width:\s*0/)
    expect(styles).toMatch(/\.search-field input,[\s\S]*\.search-field select,[\s\S]*min-width:\s*0[^}]*max-width:\s*100%/)
    expect(styles).toMatch(/\.volunteer-table-card\s*\{[^}]*min-width:\s*0/)
    expect(styles).toMatch(/\.volunteer-table-wrap\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/)
  })
})
