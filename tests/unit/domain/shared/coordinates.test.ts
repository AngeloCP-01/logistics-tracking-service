import { Coordinates } from "@/domain/shared/coordinates.js";
import { ValidationError } from "@/domain/shared/errors.js";

describe("Coordinates", () => {
  it("constructs with valid lat/lng and optional accuracy", () => {
    const c = Coordinates.of(14.5995, 120.9842, 5);
    expect(c.lat).toBe(14.5995);
    expect(c.lng).toBe(120.9842);
    expect(c.accuracy).toBe(5);
  });
  it("allows omitted accuracy (null)", () => {
    expect(Coordinates.of(14.5, 121.0).accuracy).toBeNull();
  });
  it("rejects lat out of [-90, 90]", () => {
    expect(() => Coordinates.of(91, 0)).toThrow(ValidationError);
    expect(() => Coordinates.of(-91, 0)).toThrow(ValidationError);
  });
  it("rejects lng out of [-180, 180]", () => {
    expect(() => Coordinates.of(0, 181)).toThrow(ValidationError);
    expect(() => Coordinates.of(0, -181)).toThrow(ValidationError);
  });
  it("rejects a negative accuracy", () => {
    expect(() => Coordinates.of(0, 0, -1)).toThrow(ValidationError);
  });
  it("exposes a GeoJSON point [lng, lat] for 2dsphere", () => {
    expect(Coordinates.of(14.5, 121.0).toGeoJsonPoint()).toEqual({ type: "Point", coordinates: [121.0, 14.5] });
  });
});
