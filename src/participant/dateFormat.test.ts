import { afterEach, describe, expect, it, vi } from "vitest";
import { formatEventTime, todayIso } from "./dateFormat";

afterEach(() => {
  vi.useRealTimers();
});

describe("formatEventTime", () => {
  it("formats an HH:MM time", () => {
    expect(formatEventTime("09:00")).toBe("9:00 am");
  });

  it("returns null instead of formatting garbage when the event has no start_time", () => {
    // events.start_time is a nullable column — organizer-created events can
    // omit a time entirely. Passing null straight to Intl.DateTimeFormat
    // used to build an Invalid Date and throw, crashing the whole list.
    expect(formatEventTime(null)).toBeNull();
  });
});

describe("todayIso", () => {
  it("returns Singapore's calendar date even when UTC's still thinks it's yesterday", () => {
    // 2026-08-01T02:00 SGT == 2026-07-31T18:00Z — for the six hours after
    // this instant, plain `new Date().toISOString()` would still report
    // "2026-07-31", one day behind the Singapore-based audience's calendar.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T18:00:00Z"));

    expect(todayIso()).toBe("2026-08-01");
  });

  it("agrees with plain UTC once the two calendars agree", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));

    expect(todayIso()).toBe("2026-08-01");
  });
});
