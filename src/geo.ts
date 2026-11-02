import { TrafikverketClientError } from './errors.js';

export interface LatLon {
  latitude: number;
  longitude: number;
}

const NUM = String.raw`-?\d+(?:\.\d+)?`;
/** Matches 2D and 3D points ("POINT (x y)", "POINT (x y z)", "POINT Z (x y z)"); any Z/M value is ignored. */
const WKT_POINT = new RegExp(String.raw`POINT\s*(?:[ZM]{1,2}\s*)?\(\s*(${NUM})\s+(${NUM})(?:\s+${NUM}){0,2}\s*\)`, 'i');

/**
 * Parses a WGS 84 WKT point as returned by the API, e.g. "POINT (11.9746 57.7089)" or the 3D
 * "POINT Z (11.9746 57.7089 12.5)" used by TrainPosition.
 * WKT order is longitude first, then latitude.
 */
export function parseWgs84Point(wkt: string | undefined): LatLon | undefined {
  if (!wkt) return undefined;
  const match = WKT_POINT.exec(wkt);
  if (!match) return undefined;
  return { longitude: Number(match[1]), latitude: Number(match[2]) };
}

/** Great-circle distance between two points in kilometres (haversine). */
export function distanceKm(a: LatLon, b: LatLon): number {
  const earthRadiusKm = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function validateCoordinates(latitude: number, longitude: number): void {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new TrafikverketClientError(`Invalid latitude ${latitude}: must be between -90 and 90`);
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new TrafikverketClientError(`Invalid longitude ${longitude}: must be between -180 and 180`);
  }
}

/** Rounds to one decimal place; used for distances in tool output. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
