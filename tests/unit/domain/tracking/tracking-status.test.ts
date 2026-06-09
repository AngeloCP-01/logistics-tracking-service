import { TrackingStatus, rank, isAtOrAfter } from "@/domain/tracking/tracking-status.js";

describe("TrackingStatus", () => {
  it("ranks created < in_transit < completed", () => {
    expect(rank(TrackingStatus.CREATED)).toBeLessThan(rank(TrackingStatus.IN_TRANSIT));
    expect(rank(TrackingStatus.IN_TRANSIT)).toBeLessThan(rank(TrackingStatus.COMPLETED));
  });
  it("isAtOrAfter compares by rank", () => {
    expect(isAtOrAfter(TrackingStatus.IN_TRANSIT, TrackingStatus.IN_TRANSIT)).toBe(true);
    expect(isAtOrAfter(TrackingStatus.COMPLETED, TrackingStatus.IN_TRANSIT)).toBe(true);
    expect(isAtOrAfter(TrackingStatus.CREATED, TrackingStatus.IN_TRANSIT)).toBe(false);
  });
});
