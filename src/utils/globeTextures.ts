import type { CountryWeatherAggregate } from '../types/weather';
import { sampleThermalCss, sampleThermalRGB } from './temperatureScale';
import type { CountryPolygonFeature, LonLat } from './worldGeo';

export const TEXTURE_WIDTH = 4096;
export const TEXTURE_HEIGHT = 2048;

const IDW_WIDTH = 1024;
const IDW_HEIGHT = 512;
const IDW_RADIUS_DEG = 6.5;
const GLOBAL_THERMAL_OPACITY = 0.48;
const DEG2RAD = Math.PI / 180;

// Reusable offscreen buffers for IDW interpolation (avoids per-update allocations)
let idwCanvas: HTMLCanvasElement | null = null;
let idwImageData: ImageData | null = null;
const idwWeightSum = new Float32Array(IDW_WIDTH * IDW_HEIGHT);
const idwTempWeightSum = new Float32Array(IDW_WIDTH * IDW_HEIGHT);
const idwMaxMask = new Float32Array(IDW_WIDTH * IDW_HEIGHT);

function getIdwSurface(): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  imageData: ImageData;
} {
  if (!idwCanvas) {
    idwCanvas = document.createElement('canvas');
    idwCanvas.width = IDW_WIDTH;
    idwCanvas.height = IDW_HEIGHT;
  }
  const ctx = idwCanvas.getContext('2d')!;
  if (!idwImageData) {
    idwImageData = ctx.createImageData(IDW_WIDTH, IDW_HEIGHT);
  }
  return { canvas: idwCanvas, ctx, imageData: idwImageData };
}

function lonToX(lon: number, width: number): number {
  return ((lon + 180) / 360) * width;
}

function latToY(lat: number, height: number): number {
  return ((90 - lat) / 180) * height;
}

function tracePolygonRings(
  ctx: CanvasRenderingContext2D,
  polygons: LonLat[][][],
  width: number,
  height: number,
): void {
  ctx.beginPath();
  for (const poly of polygons) {
    for (const ring of poly) {
      if (ring.length < 2) continue;
      let prevLon = ring[0][0];
      ctx.moveTo(lonToX(prevLon, width), latToY(ring[0][1], height));

      for (let i = 1; i < ring.length; i++) {
        const [lon, lat] = ring[i];
        // Prevent horizontal streak across antimeridian (+/- 180 deg)
        if (Math.abs(lon - prevLon) > 180) {
          ctx.moveTo(lonToX(lon, width), latToY(lat, height));
        } else {
          ctx.lineTo(lonToX(lon, width), latToY(lat, height));
        }
        prevLon = lon;
      }
    }
  }
}

function drawOceanAndGraticule(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#07101f');
  grad.addColorStop(0.5, '#0a182c');
  grad.addColorStop(1, '#07101f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Subtle 15-degree graticule lines
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let lon = -165; lon <= 180; lon += 15) {
    const x = lonToX(lon, width);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const y = latToY(lat, height);
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  // Equator accent
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
  ctx.beginPath();
  const eqY = latToY(0, height);
  ctx.moveTo(0, eqY);
  ctx.lineTo(width, eqY);
  ctx.stroke();
}

export function renderCountryAverageTexture(
  canvas: HTMLCanvasElement,
  features: CountryPolygonFeature[],
  aggregates: CountryWeatherAggregate[],
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  drawOceanAndGraticule(ctx, width, height);

  const aggByNumericId = new Map<string, CountryWeatherAggregate>();
  for (const agg of aggregates) {
    if (agg.numericId) {
      aggByNumericId.set(agg.numericId, agg);
    }
  }

  // Pass 1: Unconfigured countries
  for (const feat of features) {
    if (aggByNumericId.has(feat.id)) continue;
    tracePolygonRings(ctx, feat.polygons, width, height);
    ctx.fillStyle = '#152236';
    ctx.fill('evenodd');
  }

  // Pass 2: Configured countries with live average thermal color
  for (const feat of features) {
    const agg = aggByNumericId.get(feat.id);
    if (!agg) continue;

    tracePolygonRings(ctx, feat.polygons, width, height);
    if (agg.avgTemperature !== null) {
      ctx.fillStyle = sampleThermalCss(agg.avgTemperature, 0.85);
    } else {
      ctx.fillStyle = '#23324a';
    }
    ctx.fill('evenodd');
  }
}

export function renderLocalThermalTexture(
  canvas: HTMLCanvasElement,
  features: CountryPolygonFeature[],
  aggregates: CountryWeatherAggregate[],
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  drawOceanAndGraticule(ctx, width, height);

  const aggByNumericId = new Map<string, CountryWeatherAggregate>();
  for (const agg of aggregates) {
    if (agg.numericId) {
      aggByNumericId.set(agg.numericId, agg);
    }
  }

  // High-contrast land fills & coastlines beneath the global-opacity IDW thermal layer
  for (const feat of features) {
    const isConfigured = aggByNumericId.has(feat.id);
    tracePolygonRings(ctx, feat.polygons, width, height);
    ctx.fillStyle = isConfigured ? '#1e2f47' : '#142033';
    ctx.fill('evenodd');
    ctx.strokeStyle = isConfigured
      ? 'rgba(203, 213, 225, 0.5)'
      : 'rgba(100, 116, 139, 0.35)';
    ctx.lineWidth = isConfigured ? 1.5 : 1.0;
    ctx.stroke();
  }

  // Compute continuous spherical IDW thermal field into offscreen buffer (zero opacity stacking)
  idwWeightSum.fill(0);
  idwTempWeightSum.fill(0);
  idwMaxMask.fill(0);

  const radiusRad = IDW_RADIUS_DEG * DEG2RAD;

  for (const country of aggregates) {
    for (const loc of country.locations) {
      if (loc.temperature === null) continue;

      const latS = loc.latitude;
      const lonS = loc.longitude;
      const tempS = loc.temperature;
      const latSRad = latS * DEG2RAD;
      const sinLatS = Math.sin(latSRad);
      const cosLatS = Math.cos(latSRad);

      const minLat = Math.max(-89.9, latS - IDW_RADIUS_DEG);
      const maxLat = Math.min(89.9, latS + IDW_RADIUS_DEG);
      const yStart = Math.max(
        0,
        Math.floor(((90 - maxLat) / 180) * IDW_HEIGHT),
      );
      const yEnd = Math.min(
        IDW_HEIGHT - 1,
        Math.ceil(((90 - minLat) / 180) * IDW_HEIGHT),
      );

      for (let py = yStart; py <= yEnd; py++) {
        const latP = 90 - ((py + 0.5) / IDW_HEIGHT) * 180;
        const latPRad = latP * DEG2RAD;
        const sinLatP = Math.sin(latPRad);
        const cosLatP = Math.cos(latPRad);

        // Bounding longitude span at this latitude row (handles polar widening cleanly)
        const lonSpanDeg = Math.min(
          180,
          IDW_RADIUS_DEG / Math.max(0.08, cosLatP),
        );
        const xMinRaw = Math.floor(
          ((lonS - lonSpanDeg + 180) / 360) * IDW_WIDTH,
        );
        const xMaxRaw = Math.ceil(
          ((lonS + lonSpanDeg + 180) / 360) * IDW_WIDTH,
        );
        const spanPx = Math.min(IDW_WIDTH - 1, xMaxRaw - xMinRaw);

        const rowOffset = py * IDW_WIDTH;

        for (let dx = 0; dx <= spanPx; dx++) {
          const px = (((xMinRaw + dx) % IDW_WIDTH) + IDW_WIDTH) % IDW_WIDTH;
          const lonP = ((px + 0.5) / IDW_WIDTH) * 360 - 180;
          const dLonRad = (lonP - lonS) * DEG2RAD;

          const cosD = Math.max(
            -1,
            Math.min(1, sinLatP * sinLatS + cosLatP * cosLatS * Math.cos(dLonRad)),
          );
          const d = Math.acos(cosD);
          if (d >= radiusRad) continue;

          const t = 1 - d / radiusRad;
          // Smooth modified Shepard IDW weight: exact at center, smooth zero at radius boundary
          const w = (t * t) / (d * d + 0.0005);
          // Coverage mask uses max (never summed), preventing opacity from compounding
          const mask = t * t * (3 - 2 * t);

          const idx = rowOffset + px;
          idwWeightSum[idx] += w;
          idwTempWeightSum[idx] += w * tempS;
          if (mask > idwMaxMask[idx]) {
            idwMaxMask[idx] = mask;
          }
        }
      }
    }
  }

  const { canvas: offCanvas, ctx: offCtx, imageData } = getIdwSurface();
  const data = imageData.data;

  for (let idx = 0; idx < IDW_WIDTH * IDW_HEIGHT; idx++) {
    const p = idx * 4;
    const mask = idwMaxMask[idx];
    const wSum = idwWeightSum[idx];

    if (mask <= 0.002 || wSum <= 0) {
      data[p] = 0;
      data[p + 1] = 0;
      data[p + 2] = 0;
      data[p + 3] = 0;
      continue;
    }

    const blendedTemp = idwTempWeightSum[idx] / wSum;
    const [r, g, b] = sampleThermalRGB(blendedTemp);
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
    data[p + 3] = Math.round(255 * GLOBAL_THERMAL_OPACITY * mask);
  }

  offCtx.putImageData(imageData, 0, 0);

  // Composite the single global-opacity thermal gradient field once over the map
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(offCanvas, 0, 0, width, height);
  ctx.restore();
}

export function renderLandRoughnessTexture(
  canvas: HTMLCanvasElement,
  features: CountryPolygonFeature[],
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;

  // Ocean = smoother (lower roughness ~0.32 -> gray value 82)
  ctx.fillStyle = 'rgb(84, 84, 84)';
  ctx.fillRect(0, 0, width, height);

  // Land = matte cartographic surface (higher roughness ~0.82 -> gray value 210)
  for (const feat of features) {
    tracePolygonRings(ctx, feat.polygons, width, height);
    ctx.fillStyle = 'rgb(210, 210, 210)';
    ctx.fill('evenodd');
  }
}
