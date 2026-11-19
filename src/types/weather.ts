export interface WeatherLocationConfig {
  name?: string;
  latitude: number;
  longitude: number;
  url: string;
}

export interface CountryConfig {
  name: string;
  ISO: string;
  weatherLocations: WeatherLocationConfig[];
}

export interface WeatherWorldConfig {
  zoomAggregate: number;
  countries: CountryConfig[];
}

export interface LocationWeatherReading {
  key: string;
  countryISO: string;
  countryName: string;
  locationName: string;
  latitude: number;
  longitude: number;
  url: string;
  status: 'loading' | 'live' | 'error';
  temperature: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  humidity: number | null;
  updatedAt: string | null;
  errorMessage?: string;
}

export interface CountryWeatherAggregate {
  ISO: string;
  name: string;
  numericId: string | null;
  avgTemperature: number | null;
  minTemperature: number | null;
  maxTemperature: number | null;
  avgWindSpeed: number | null;
  avgHumidity: number | null;
  liveCount: number;
  totalCount: number;
  locations: LocationWeatherReading[];
}

export type AggregationMode = 'auto' | 'country' | 'local';
