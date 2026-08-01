import { describe, expect, it } from "vitest";
import { formatPhoneNumberAsYouType, isValidParticipantPhoneNumber } from "./phone";

describe("formatPhoneNumberAsYouType", () => {
  it("inserts spaces into a local Singapore number as it's typed", () => {
    expect(formatPhoneNumberAsYouType("91234567")).toBe("9123 4567");
  });

  it("formats an international number using its own country code", () => {
    expect(formatPhoneNumberAsYouType("+14155552671")).toBe("+1 415 555 2671");
  });

  it("formats incrementally, one keystroke at a time, to the same result", () => {
    const digits = "+6591234567";
    let typed = "";
    for (const char of digits) {
      typed = formatPhoneNumberAsYouType(typed + char);
    }
    expect(typed).toBe(formatPhoneNumberAsYouType(digits));
  });
});

describe("isValidParticipantPhoneNumber", () => {
  it("accepts a valid local Singapore number", () => {
    expect(isValidParticipantPhoneNumber("9123 4567")).toBe(true);
  });

  it("accepts a valid foreign number with an explicit country code", () => {
    expect(isValidParticipantPhoneNumber("+1 415 555 2671")).toBe(true);
  });

  it("rejects an incomplete number", () => {
    expect(isValidParticipantPhoneNumber("912")).toBe(false);
  });

  it("rejects garbage input", () => {
    expect(isValidParticipantPhoneNumber("not a phone number")).toBe(false);
  });
});
