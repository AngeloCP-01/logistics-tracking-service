import { ValidationError } from "./errors.js";

export class Coordinates {
  private constructor(
    readonly lat: number,
    readonly lng: number,
    readonly accuracy: number | null,
  ) {}

  static of(lat: number, lng: number, accuracy?: number): Coordinates {
    const errors: { field: string; message: string }[] = [];
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.push({ field: "lat", message: "must be in [-90, 90]" });
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.push({ field: "lng", message: "must be in [-180, 180]" });
    if (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0)) errors.push({ field: "accuracy", message: "must be >= 0" });
    if (errors.length) throw new ValidationError(errors);
    return new Coordinates(lat, lng, accuracy ?? null);
  }

  /** GeoJSON Point for a 2dsphere index — coordinates are [longitude, latitude]. */
  toGeoJsonPoint(): { type: "Point"; coordinates: [number, number] } {
    return { type: "Point", coordinates: [this.lng, this.lat] };
  }
}
