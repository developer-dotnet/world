import * as THREE from 'three';
import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import countriesAtlas from 'world-atlas/countries-50m.json';
import { ISO3_TO_NUMERIC, NUMERIC_TO_ISO3 } from './isoMapping';

export type LonLat = [number, number];

export interface CountryPolygonFeature {
  id: string;
  iso3: string | null;
  name: string;
  rings: LonLat[][]; // outer rings & holes flattened per polygon part
  polygons: LonLat[][][]; // array of polygons, each polygon = array of rings
  bbox: {
    minLon: number;
    maxLon: number;
    minLat: number;
    maxLat: number;
  };
  centroid: {
    lon: number;
    lat: number;
  };
}

let cachedFeatures: CountryPolygonFeature[] | null = null;
let cachedBorderLines: LonLat[][] | null = null;

export function getWorldBorderLines(): LonLat[][] {
  if (cachedBorderLines) return cachedBorderLines;
  const topology = countriesAtlas as unknown as Topology<{
    countries: GeometryCollection<{ name?: string }>;
  }>;
  const borders = mesh(topology, topology.objects.countries);
  cachedBorderLines = borders.coordinates as LonLat[][];
  return cachedBorderLines;
}

function computeRingAreaAndCentroid(ring: LonLat[]): {
  area: number;
  lon: number;
  lat: number;
} {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[i];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-6) {
    let sumLon = 0;
    let sumLat = 0;
    for (const [lon, lat] of ring) {
      sumLon += lon;
      sumLat += lat;
    }
    const n = ring.length || 1;
    return { area: 0, lon: sumLon / n, lat: sumLat / n };
  }
  return {
    area: Math.abs(area),
    lon: cx / (6 * area),
    lat: cy / (6 * area),
  };
}

export function getWorldCountryFeatures(): CountryPolygonFeature[] {
  if (cachedFeatures) return cachedFeatures;

  const topology = countriesAtlas as unknown as Topology<{
    countries: GeometryCollection<{ name?: string }>;
  }>;

  const geo = feature(topology, topology.objects.countries);

  const features: CountryPolygonFeature[] = [];

  for (const feat of geo.features) {
    if (!feat.geometry) continue;
    const rawId = feat.id != null ? String(feat.id).padStart(3, '0') : '';
    const name = feat.properties?.name || rawId || 'Unknown';
    const iso3 = rawId ? NUMERIC_TO_ISO3[rawId] ?? null : null;

    let polygons: LonLat[][][] = [];
    if (feat.geometry.type === 'Polygon') {
      polygons = [feat.geometry.coordinates as LonLat[][]];
    } else if (feat.geometry.type === 'MultiPolygon') {
      polygons = feat.geometry.coordinates as LonLat[][][];
    } else {
      continue;
    }

    const rings: LonLat[][] = [];
    let minLon = 180;
    let maxLon = -180;
    let minLat = 90;
    let maxLat = -90;

    let bestArea = -1;
    let bestCentroid = { lon: 0, lat: 0 };

    for (const poly of polygons) {
      if (poly.length === 0) continue;
      const outer = poly[0];
      const c = computeRingAreaAndCentroid(outer);
      if (c.area > bestArea) {
        bestArea = c.area;
        bestCentroid = { lon: c.lon, lat: c.lat };
      }
      for (const ring of poly) {
        rings.push(ring);
        for (const [lon, lat] of ring) {
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }

    features.push({
      id: rawId || name,
      iso3,
      name,
      rings,
      polygons,
      bbox: { minLon, maxLon, minLat, maxLat },
      centroid: bestCentroid,
    });
  }

  cachedFeatures = features;
  return features;
}

export function resolveCountryFeature(
  iso3: string,
  name: string,
  features: CountryPolygonFeature[],
): CountryPolygonFeature | undefined {
  const upperIso = iso3.trim().toUpperCase();
  const normName = name.trim().toLowerCase();
  const numericId = ISO3_TO_NUMERIC[upperIso];

  if (numericId) {
    const matches = features.filter((f) => f.id === numericId);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      const exactName = matches.find(
        (f) => f.name.toLowerCase() === normName,
      );
      if (exactName) return exactName;
      // Pick largest bounding box span
      return matches.slice().sort((a, b) => {
        const spanA =
          (a.bbox.maxLon - a.bbox.minLon) * (a.bbox.maxLat - a.bbox.minLat);
        const spanB =
          (b.bbox.maxLon - b.bbox.minLon) * (b.bbox.maxLat - b.bbox.minLat);
        return spanB - spanA;
      })[0];
    }
  }

  const byIso = features.find((f) => f.iso3 === upperIso);
  if (byIso) return byIso;

  return (
    features.find((f) => f.name.toLowerCase() === normName) ||
    features.find(
      (f) =>
        f.name.toLowerCase().includes(normName) ||
        normName.includes(f.name.toLowerCase()),
    )
  );
}

function pointInRing(lon: number, lat: number, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    // Skip antimeridian wrap segments (> 180 deg jump)
    if (Math.abs(xi - xj) > 180) continue;

    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function findCountryAtLatLon(
  lat: number,
  lon: number,
  features: CountryPolygonFeature[],
): CountryPolygonFeature | null {
  for (const feat of features) {
    const { minLon, maxLon, minLat, maxLat } = feat.bbox;
    if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) {
      continue;
    }
    for (const poly of feat.polygons) {
      if (poly.length === 0) continue;
      if (pointInRing(lon, lat, poly[0])) {
        let inHole = false;
        for (let h = 1; h < poly.length; h++) {
          if (pointInRing(lon, lat, poly[h])) {
            inHole = true;
            break;
          }
        }
        if (!inHole) return feat;
      }
    }
  }
  return null;
}

export function latLonToVector3(
  lat: number,
  lon: number,
  radius: number,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const sinPhi = Math.sin(phi);
  target.set(
    -radius * sinPhi * Math.cos(theta),
    radius * Math.cos(phi),
    radius * sinPhi * Math.sin(theta),
  );
  return target;
}

export function vector3ToLatLon(point: THREE.Vector3): {
  lat: number;
  lon: number;
} {
  const r = point.length() || 1;
  const clampedY = Math.max(-1, Math.min(1, point.y / r));
  const phi = Math.acos(clampedY);
  const lat = 90 - (phi * 180) / Math.PI;

  let theta = Math.atan2(point.z, -point.x);
  if (theta < 0) theta += Math.PI * 2;
  let lon = (theta * 180) / Math.PI - 180;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;

  return { lat, lon };
}
