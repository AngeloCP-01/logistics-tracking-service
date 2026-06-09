import { toMeasurement } from "@/infrastructure/persistence/mongo-location-repository.js";
import { Coordinates } from "@/domain/shared/coordinates.js";
import { OrderId, DriverId } from "@/domain/shared/ids.js";

const TS = new Date("2026-06-09T10:00:00.000Z");
const OID = OrderId.of("018f4e1a-1c2b-7c3d-8e4f-5a6b7c8d9e0f");
const D1 = DriverId.of("018f4e1a-0bbb-7c3d-8e4f-5a6b7c8d9e0f");

describe("toMeasurement", () => {
  it("shapes a time-series measurement with meta + GeoJSON point", () => {
    const doc = toMeasurement(OID, D1, Coordinates.of(14.5, 121.0, 5), TS);
    expect(doc).toEqual({
      ts: TS,
      meta: { orderId: OID, driverId: D1 },
      lat: 14.5, lng: 121.0, accuracy: 5,
      point: { type: "Point", coordinates: [121.0, 14.5] },
    });
  });
  it("omits accuracy when null", () => {
    const doc = toMeasurement(OID, D1, Coordinates.of(14.5, 121.0), TS);
    expect(doc).not.toHaveProperty("accuracy");
  });
});
