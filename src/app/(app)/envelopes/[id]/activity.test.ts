import { describe, it, expect } from "vitest";
import { describeEvent, relativeTime } from "./activity";

describe("activity wording", () => {
  it("names signers and falls back for unknown events", () => {
    expect(describeEvent("signed", "Ada")).toBe("Ada signed");
    expect(describeEvent("some_new_event", "Ada")).toBe("some new event");
  });
  it("formats relative times", () => {
    const now = new Date("2026-09-29T12:00:00Z");
    expect(relativeTime(new Date("2026-09-29T11:59:30Z"), now)).toBe("just now");
    expect(relativeTime(new Date("2026-09-29T11:45:00Z"), now)).toBe("15 min ago");
    expect(relativeTime(new Date("2026-09-29T09:00:00Z"), now)).toBe("3 h ago");
    expect(relativeTime(new Date("2026-09-20T12:00:00Z"), now)).toBe("2026-09-20");
  });
});
