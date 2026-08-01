// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { clearStoredParticipant, getStoredParticipant, storeParticipant } from "./identity"

afterEach(() => {
  localStorage.clear()
})

describe("participant identity storage", () => {
  it("returns null when nothing is stored", () => {
    expect(getStoredParticipant()).toBeNull()
  })

  it("round-trips a stored participant", () => {
    storeParticipant({
      participantId: 7,
      name: "Alice",
      contactNumber: "+6591234567",
      email: "alice@example.com",
    })
    expect(getStoredParticipant()).toEqual({
      participantId: 7,
      name: "Alice",
      contactNumber: "+6591234567",
      email: "alice@example.com",
    })
  })

  it("clears the stored participant", () => {
    storeParticipant({ participantId: 7, name: "Alice", contactNumber: "+6591234567", email: null })
    clearStoredParticipant()
    expect(getStoredParticipant()).toBeNull()
  })

  it("ignores malformed JSON", () => {
    localStorage.setItem("p2s.participant", "{not json")
    expect(getStoredParticipant()).toBeNull()
  })
})
