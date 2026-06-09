import { OrderId, DriverId, UserId } from "@/domain/shared/ids.js";

describe("ids", () => {
  it("accepts a valid uuid for each branded id", () => {
    const u = "018f4e1a-1c2b-7c3d-8e4f-5a6b7c8d9e0f";
    expect(OrderId.of(u)).toBe(u);
    expect(DriverId.of(u)).toBe(u);
    expect(UserId.of(u)).toBe(u);
  });
  it("rejects a non-uuid", () => {
    expect(() => OrderId.of("nope")).toThrow();
    expect(() => DriverId.of("nope")).toThrow();
    expect(() => UserId.of("nope")).toThrow();
  });
});
