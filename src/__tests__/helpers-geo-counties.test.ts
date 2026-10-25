import { describe, expect, it } from 'vitest';
import { resolveCounty } from '../counties.js';
import { distanceKm, parseWgs84Point, validateCoordinates } from '../geo.js';

describe('geo helpers', () => {
  it('parses WKT points with longitude first', () => {
    expect(parseWgs84Point('POINT (11.9746 57.7089)')).toEqual({ latitude: 57.7089, longitude: 11.9746 });
    expect(parseWgs84Point('point(-1.5 -2.25)')).toEqual({ latitude: -2.25, longitude: -1.5 });
  });

  it('returns undefined for missing or non-point geometry', () => {
    expect(parseWgs84Point(undefined)).toBeUndefined();
    expect(parseWgs84Point('LINESTRING (1 2, 3 4)')).toBeUndefined();
  });

  it('computes great-circle distance', () => {
    const stockholm = { latitude: 59.3293, longitude: 18.0686 };
    const gothenburg = { latitude: 57.7089, longitude: 11.9746 };
    const km = distanceKm(stockholm, gothenburg);
    expect(km).toBeGreaterThan(385);
    expect(km).toBeLessThan(400);
    expect(distanceKm(stockholm, stockholm)).toBe(0);
  });

  it('validates coordinate ranges', () => {
    expect(() => validateCoordinates(91, 0)).toThrow(/Invalid latitude/);
    expect(() => validateCoordinates(0, 181)).toThrow(/Invalid longitude/);
    expect(() => validateCoordinates(59, 18)).not.toThrow();
  });
});

describe('resolveCounty', () => {
  it('resolves Swedish names regardless of case, diacritics and "län"', () => {
    expect(resolveCounty('Västra Götaland')).toBe(14);
    expect(resolveCounty('vastra gotaland')).toBe(14);
    expect(resolveCounty('Skåne län')).toBe(12);
    expect(resolveCounty('stockholm')).toBe(1);
  });

  it('resolves English aliases', () => {
    expect(resolveCounty('Scania')).toBe(12);
  });

  it('accepts numeric codes as numbers or strings', () => {
    expect(resolveCounty(14)).toBe(14);
    expect(resolveCounty('25')).toBe(25);
  });

  it('rejects unknown counties and codes', () => {
    expect(() => resolveCounty('Atlantis')).toThrow(/Unknown county "Atlantis"/);
    expect(() => resolveCounty(99)).toThrow(/Unknown county code 99/);
  });
});
