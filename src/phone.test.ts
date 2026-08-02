import { describe, expect, it } from "vitest"
import {
  formatLocalPhoneAsYouType,
  formatPhoneForDisplay,
  isValidInternationalPhone,
  splitInternationalPhone,
  toInternationalPhone,
} from "./phone"

describe("volunteer phone helpers", () => {
  it("formats a Singapore number while preserving a separate country code", () => {
    expect(formatLocalPhoneAsYouType("+65", "91234567")).toBe("9123 4567")
    expect(toInternationalPhone("+65", "9123 4567")).toBe("+6591234567")
  })

  it("validates supported international numbers", () => {
    expect(isValidInternationalPhone("+65", "9123 4567")).toBe(true)
    expect(isValidInternationalPhone("+1", "415 555 2671")).toBe(true)
    expect(isValidInternationalPhone("+65", "1234")).toBe(false)
  })

  it("formats stored E.164 numbers for display", () => {
    expect(formatPhoneForDisplay("+6591234567")).toBe("+65 9123 4567")
  })

  it("splits a stored number back into the country picker and local input", () => {
    expect(splitInternationalPhone("+14155552671")).toEqual({
      countryCode: "+1",
      localPhone: "(415) 555-2671",
    })
  })
})
