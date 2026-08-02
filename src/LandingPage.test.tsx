import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const styles = readFileSync(new URL("./index.css", import.meta.url), "utf8")

describe("mobile landing page layout", () => {
  it("uses the mobile viewport as the hero height and avoids oversized top spacing", () => {
    expect(styles).toMatch(/@media \(max-width: 810px\)[\s\S]*?\.hero \{[\s\S]*?min-height: 100svh;/)
    expect(styles).toMatch(/@media \(max-width: 810px\)[\s\S]*?\.hero \{[\s\S]*?justify-content: flex-start;[\s\S]*?padding: 24px 18px 24px;/)
  })

  it("keeps account form controls at 16px on mobile to prevent browser zoom", () => {
    expect(styles).toMatch(
      /@media \(max-width: 680px\)[\s\S]*?\.pts-account-card \.pts-field input,[\s\S]*?\.pts-account-card \.pts-field select \{ font-size: 16px; \}/,
    )
    expect(styles).toMatch(
      /@media \(max-width: 680px\)[\s\S]*?\.admin-login-form input \{ font-size: 16px; \}/,
    )
  })
})
