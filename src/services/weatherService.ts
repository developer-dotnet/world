import type {
  CountryWeatherAggregate,
  LocationWeatherReading,
  WeatherWorldConfig,
} from '../types/weather';
import {
  getWorldCountryFeatures,
  resolveCountryFeature,
} from '../utils/worldGeo';

export async function loadWeatherConfig(
  url = `${import.meta.env.BASE_URL}weather-config.json`,
): Promise<WeatherWorldConfig> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to load ${url} (HTTP ${res.status})`);
  }
  const data = (await res.json()) as WeatherWorldConfig;
  validateWeatherConfig(data);
  return data;
}

export function validateWeatherConfig(
  data: unknown,
): asserts data is WeatherWorldConfig {
  if (!data || typeof data !== 'object') {
    throw new Error('Config must be a JSON object');
  }
  const obj = data as Record<string, unknown>;
  if (
    typeof obj.zoomAggregate !== 'number' ||
    !Number.isFinite(obj.zoomAggregate)
  ) {
    throw new Error('Config must include numeric "zoomAggregate"');
  }
  if (!Array.isArray(obj.countries)) {
    throw new Error('Config must include a "countries" array');
  }
  for (const country of obj.countries) {
    if (!country || typeof country !== 'object') {
      throw new Error('Each country entry must be an object');
    }
    const c = country as Record<string, unknown>;
    if (typeof c.name !== 'string' || typeof c.ISO !== 'string') {
      throw new Error('Each country requires "name" and "ISO" strings');
    }
    if (!Array.isArray(c.weatherLocations)) {
      throw new Error(`Country "${c.name}" requires "weatherLocations" array`);
    }
    for (const loc of c.weatherLocations) {
      if (!loc || typeof loc !== 'object') {
        throw new Error(`Invalid weatherLocation in "${c.name}"`);
      }
      const l = loc as Record<string, unknown>;
      if (
        typeof l.latitude !== 'number' ||
        typeof l.longitude !== 'number' ||
        typeof l.url !== 'string'
      ) {
        throw new Error(
          `Each weatherLocation in "${c.name}" requires numeric latitude, longitude, and string url`,
        );
      }
    }
  }
}

interface ParsedWeatherPayload {
  temperature: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  humidity: number | null;
}

function parseWeatherResponse(payload: unknown): ParsedWeatherPayload {
  if (!payload || typeof payload !== 'object') {
    return {
      temperature: null,
      windSpeed: null,
      windDirection: null,
      humidity: null,
    };
  }
  const data = payload as Record<string, unknown>;

  if (data.current && typeof data.current === 'object') {
    const cur = data.current as Record<string, unknown>;
    return {
      temperature:
        typeof cur.temperature_2m === 'number' ? cur.temperature_2m : null,
      windSpeed:
        typeof cur.wind_speed_10m === 'number' ? cur.wind_speed_10m : null,
      windDirection:
        typeof cur.wind_direction_10m === 'number'
          ? cur.wind_direction_10m
          : null,
      humidity:
        typeof cur.relative_humidity_2m === 'number'
          ? cur.relative_humidity_2m
          : null,
    };
  }

  if (data.current_weather && typeof data.current_weather === 'object') {
    const cw = data.current_weather as Record<string, unknown>;
    return {
      temperature: typeof cw.temperature === 'number' ? cw.temperature : null,
      windSpeed: typeof cw.windspeed === 'number' ? cw.windspeed : null,
      windDirection:
        typeof cw.winddirection === 'number' ? cw.winddirection : null,
      humidity: null,
    };
  }

  const main = (
    data.main && typeof data.main === 'object' ? data.main : data
  ) as Record<string, unknown>;
  const wind = (
    data.wind && typeof data.wind === 'object' ? data.wind : data
  ) as Record<string, unknown>;

  const tempCandidate =
    main.temperature ?? main.temp ?? main.temperature_2m ?? data.temperature;
  const windCandidate =
    wind.wind_speed ?? wind.windSpeed ?? wind.speed ?? data.wind_speed;
  const dirCandidate =
    wind.wind_direction ??
    wind.windDirection ??
    wind.deg ??
    data.wind_direction;
  const humCandidate =
    main.humidity ?? main.relative_humidity_2m ?? data.humidity;

  return {
    temperature: typeof tempCandidate === 'number' ? tempCandidate : null,
    windSpeed: typeof windCandidate === 'number' ? windCandidate : null,
    windDirection: typeof dirCandidate === 'number' ? dirCandidate : null,
    humidity: typeof humCandidate === 'number' ? humCandidate : null,
  };
}

export function buildInitialAggregates(
  config: WeatherWorldConfig,
): CountryWeatherAggregate[] {
  const features = getWorldCountryFeatures();

  return config.countries.map((country) => {
    const matched = resolveCountryFeature(country.ISO, country.name, features);
    const locations: LocationWeatherReading[] = country.weatherLocations.map(
      (loc, idx) => ({
        key: `${country.ISO}-${idx}-${loc.latitude.toFixed(3)}-${loc.longitude.toFixed(3)}`,
        countryISO: country.ISO,
        countryName: country.name,
        locationName:
          loc.name?.trim() ||
          `${loc.latitude.toFixed(2)}°, ${loc.longitude.toFixed(2)}°`,
        latitude: loc.latitude,
        longitude: loc.longitude,
        url: loc.url,
        status: 'loading',
        temperature: null,
        windSpeed: null,
        windDirection: null,
        humidity: null,
        updatedAt: null,
      }),
    );

    return {
      ISO: country.ISO,
      name: country.name,
      numericId: matched?.id ?? null,
      avgTemperature: null,
      minTemperature: null,
      maxTemperature: null,
      avgWindSpeed: null,
      avgHumidity: null,
      liveCount: 0,
      totalCount: locations.length,
      locations,
    };
  });
}

export function recomputeCountryAggregate(
  country: CountryWeatherAggregate,
): CountryWeatherAggregate {
  const liveTemps = country.locations
    .map((l) => l.temperature)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const liveWinds = country.locations
    .map((l) => l.windSpeed)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const liveHumidities = country.locations
    .map((l) => l.humidity)
    .filter((v): v is number => v !== null && Number.isFinite(v));

  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  return {
    ...country,
    avgTemperature: avg(liveTemps),
    minTemperature: liveTemps.length ? Math.min(...liveTemps) : null,
    maxTemperature: liveTemps.length ? Math.max(...liveTemps) : null,
    avgWindSpeed: avg(liveWinds),
    avgHumidity: avg(liveHumidities),
    liveCount: liveTemps.length,
  };
}

interface LocationTask {
  countryIdx: number;
  locIdx: number;
  loc: LocationWeatherReading;
}

function getOpenMeteoBatchSignature(urlStr: string): string | null {
  try {
    const parsed = new URL(urlStr);
    if (
      parsed.hostname !== 'api.open-meteo.com' ||
      !parsed.pathname.startsWith('/v1/forecast')
    ) {
      return null;
    }
    const params = new URLSearchParams(parsed.search);
    if (!params.has('latitude') || !params.has('longitude')) {
      return null;
    }
    params.delete('latitude');
    params.delete('longitude');
    const rest = params.toString();
    return `${parsed.origin}${parsed.pathname}?${rest}`;
  } catch {
    return null;
  }
}

export async function fetchAllWeatherReadings(
  initialAggregates: CountryWeatherAggregate[],
  onProgress: (updated: CountryWeatherAggregate[]) => void,
  signal?: AbortSignal,
): Promise<CountryWeatherAggregate[]> {
  const current = initialAggregates.map((c) => ({
    ...c,
    locations: c.locations.map((l) => ({ ...l })),
  }));

  const openMeteoGroups = new Map<string, LocationTask[]>();
  const singleTasks: LocationTask[] = [];

  current.forEach((country, countryIdx) => {
    country.locations.forEach((loc, locIdx) => {
      const task: LocationTask = { countryIdx, locIdx, loc };
      const sig = getOpenMeteoBatchSignature(loc.url);
      if (sig) {
        const list = openMeteoGroups.get(sig) ?? [];
        list.push(task);
        openMeteoGroups.set(sig, list);
      } else {
        singleTasks.push(task);
      }
    });
  });

  const BATCH_SIZE = 40;
  const batchJobs: Array<{ baseSig: string; items: LocationTask[] }> = [];
  for (const [baseSig, items] of openMeteoGroups.entries()) {
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      batchJobs.push({ baseSig, items: items.slice(i, i + BATCH_SIZE) });
    }
  }

  const touchCountries = (indices: Set<number>) => {
    for (const cIdx of indices) {
      current[cIdx] = recomputeCountryAggregate(current[cIdx]);
    }
    onProgress(current.map((c) => ({ ...c, locations: [...c.locations] })));
  };

  // Run batched Open-Meteo calls (up to 3 concurrent batches)
  let batchCursor = 0;
  async function runBatchWorker() {
    while (batchCursor < batchJobs.length) {
      if (signal?.aborted) return;
      const job = batchJobs[batchCursor++];

      const lats = job.items.map((t) => t.loc.latitude).join(',');
      const lons = job.items.map((t) => t.loc.longitude).join(',');
      const sep = job.baseSig.endsWith('?') ? '' : '&';
      const batchUrl = `${job.baseSig}${sep}latitude=${lats}&longitude=${lons}`;

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 12000);
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });

      const touched = new Set<number>();

      try {
        const res = await fetch(batchUrl, { signal: controller.signal });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        const itemsPayload: unknown[] = Array.isArray(json) ? json : [json];

        job.items.forEach((task, idx) => {
          const parsed = parseWeatherResponse(itemsPayload[idx]);
          touched.add(task.countryIdx);
          if (parsed.temperature === null) {
            current[task.countryIdx].locations[task.locIdx] = {
              ...task.loc,
              status: 'error',
              errorMessage: 'No temperature value in payload',
            };
          } else {
            current[task.countryIdx].locations[task.locIdx] = {
              ...task.loc,
              status: 'live',
              temperature: parsed.temperature,
              windSpeed: parsed.windSpeed,
              windDirection: parsed.windDirection,
              humidity: parsed.humidity,
              updatedAt: new Date().toISOString(),
              errorMessage: undefined,
            };
          }
        });
      } catch (err) {
        if (signal?.aborted) return;
        const msg = err instanceof Error ? err.message : 'Fetch error';
        for (const task of job.items) {
          touched.add(task.countryIdx);
          current[task.countryIdx].locations[task.locIdx] = {
            ...task.loc,
            status: 'error',
            errorMessage: msg,
          };
        }
      } finally {
        window.clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
      }

      if (!signal?.aborted) {
        touchCountries(touched);
      }
    }
  }

  // Run any custom non-Open-Meteo individual URLs concurrently
  let singleCursor = 0;
  async function runSingleWorker() {
    while (singleCursor < singleTasks.length) {
      if (signal?.aborted) return;
      const task = singleTasks[singleCursor++];
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 9000);
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        const res = await fetch(task.loc.url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const parsed = parseWeatherResponse(json);
        if (parsed.temperature === null) {
          throw new Error('No temperature value in payload');
        }
        current[task.countryIdx].locations[task.locIdx] = {
          ...task.loc,
          status: 'live',
          temperature: parsed.temperature,
          windSpeed: parsed.windSpeed,
          windDirection: parsed.windDirection,
          humidity: parsed.humidity,
          updatedAt: new Date().toISOString(),
          errorMessage: undefined,
        };
      } catch (err) {
        if (signal?.aborted) return;
        current[task.countryIdx].locations[task.locIdx] = {
          ...task.loc,
          status: 'error',
          errorMessage: err instanceof Error ? err.message : 'Fetch error',
        };
      } finally {
        window.clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
      }

      if (!signal?.aborted) {
        touchCountries(new Set([task.countryIdx]));
      }
    }
  }

  await Promise.all([
    ...Array.from({ length: Math.min(3, batchJobs.length) }, () =>
      runBatchWorker(),
    ),
    ...Array.from({ length: Math.min(6, singleTasks.length) }, () =>
      runSingleWorker(),
    ),
  ]);

  if (!signal?.aborted) {
    onProgress(current.map((c) => ({ ...c, locations: [...c.locations] })));
  }

  return current;
}
