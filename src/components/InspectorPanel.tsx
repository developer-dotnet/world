import { Compass, Droplets, MapPin, Wind, X } from 'lucide-react';
import type {
  CountryWeatherAggregate,
  LocationWeatherReading,
} from '../types/weather';
import { sampleThermalCss } from '../utils/temperatureScale';

interface InspectorPanelProps {
  countryAggregate: CountryWeatherAggregate | null;
  unconfiguredCountryName: string | null;
  activeLocation: LocationWeatherReading | null;
  isLocalMode: boolean;
  isPinned: boolean;
  onSelectLocation: (loc: LocationWeatherReading) => void;
  onClearSelection: () => void;
}

export function InspectorPanel({
  countryAggregate,
  unconfiguredCountryName,
  activeLocation,
  isLocalMode,
  isPinned,
  onSelectLocation,
  onClearSelection,
}: InspectorPanelProps) {
  if (!countryAggregate && !unconfiguredCountryName && !activeLocation) {
    return null;
  }

  return (
    <aside
      className="pointer-events-auto w-72 border border-slate-800/90 bg-[#0B101A]/92 text-slate-100 sm:w-80"
      aria-label="Location weather inspector"
    >
      <div className="flex items-start justify-between gap-2 border-b border-slate-800/80 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>
              {isLocalMode ? 'Local Station Shade' : 'Country Average'}
            </span>
            {countryAggregate && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-slate-300">
                  {countryAggregate.ISO}
                </span>
              </>
            )}
          </div>
          <h2 className="mt-0.5 truncate text-base font-semibold text-slate-100">
            {countryAggregate?.name ?? unconfiguredCountryName}
          </h2>
        </div>

        {isPinned && (
          <button
            type="button"
            onClick={onClearSelection}
            className="p-1 text-slate-400 transition-colors hover:text-slate-100"
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {!countryAggregate && unconfiguredCountryName && (
        <div className="px-4 py-3 text-xs text-slate-400">
          No weather stations configured for this country in{' '}
          <span className="font-mono text-slate-300">weather-config.json</span>.
        </div>
      )}

      {countryAggregate && (
        <div className="px-4 py-3">
          {/* Country Aggregate Summary */}
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span
                className="inline-block h-3 w-3 shrink-0"
                style={{
                  backgroundColor:
                    countryAggregate.avgTemperature !== null
                      ? sampleThermalCss(countryAggregate.avgTemperature)
                      : '#475569',
                }}
              />
              <span className="font-mono text-2xl font-semibold tabular-nums text-slate-50">
                {countryAggregate.avgTemperature !== null
                  ? countryAggregate.avgTemperature.toFixed(1)
                  : '--'}
              </span>
              <span className="font-mono text-xs text-slate-400">°C avg</span>
            </div>

            <span className="font-mono text-xs tabular-nums text-slate-400">
              {countryAggregate.liveCount}/{countryAggregate.totalCount} live
            </span>
          </div>

          <div className="mt-2.5 grid grid-cols-3 gap-2 border-y border-slate-800/80 py-2 text-xs">
            <div>
              <div className="text-[11px] text-slate-400">Range</div>
              <div className="mt-0.5 font-mono tabular-nums text-slate-200">
                {countryAggregate.minTemperature !== null &&
                countryAggregate.maxTemperature !== null
                  ? `${countryAggregate.minTemperature.toFixed(0)}°..${countryAggregate.maxTemperature.toFixed(0)}°`
                  : '--'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">Wind</div>
              <div className="mt-0.5 font-mono tabular-nums text-slate-200">
                {countryAggregate.avgWindSpeed !== null
                  ? `${countryAggregate.avgWindSpeed.toFixed(1)} km/h`
                  : '--'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">Humidity</div>
              <div className="mt-0.5 font-mono tabular-nums text-slate-200">
                {countryAggregate.avgHumidity !== null
                  ? `${Math.round(countryAggregate.avgHumidity)}%`
                  : '--'}
              </div>
            </div>
          </div>

          {/* Focused Station Detail */}
          {activeLocation && (
            <div className="mt-3 border border-slate-800 bg-slate-900/70 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-100">
                  <MapPin className="h-3.5 w-3.5 text-cyan-400" />
                  <span className="truncate">{activeLocation.locationName}</span>
                </div>
                <span className="font-mono text-sm font-semibold tabular-nums text-slate-50">
                  {activeLocation.temperature !== null
                    ? `${activeLocation.temperature.toFixed(1)} °C`
                    : activeLocation.status === 'error'
                      ? 'Err'
                      : '...'}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-slate-400">
                <span>
                  {activeLocation.latitude.toFixed(2)}°,{' '}
                  {activeLocation.longitude.toFixed(2)}°
                </span>
                {activeLocation.windSpeed !== null && (
                  <span className="inline-flex items-center gap-1">
                    <Wind className="h-3 w-3" />
                    {activeLocation.windSpeed.toFixed(1)} km/h
                  </span>
                )}
                {activeLocation.windDirection !== null && (
                  <span className="inline-flex items-center gap-1">
                    <Compass className="h-3 w-3" />
                    {Math.round(activeLocation.windDirection)}°
                  </span>
                )}
                {activeLocation.humidity !== null && (
                  <span className="inline-flex items-center gap-1">
                    <Droplets className="h-3 w-3" />
                    {Math.round(activeLocation.humidity)}%
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Country Weather Locations List */}
          <div className="mt-3">
            <div className="mb-1.5 text-[11px] font-medium text-slate-400">
              Weather Locations (click to zoom)
            </div>
            <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
              {countryAggregate.locations.map((loc) => {
                const isSelected = activeLocation?.key === loc.key;
                return (
                  <button
                    key={loc.key}
                    type="button"
                    onClick={() => onSelectLocation(loc)}
                    className={`flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs transition-colors ${
                      isSelected
                        ? 'bg-slate-800 text-slate-50'
                        : 'hover:bg-slate-800/60 text-slate-300'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0"
                        style={{
                          backgroundColor:
                            loc.temperature !== null
                              ? sampleThermalCss(loc.temperature)
                              : '#475569',
                        }}
                      />
                      <span className="truncate">{loc.locationName}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 font-mono tabular-nums">
                      <span className="text-[11px] text-slate-400">
                        {loc.windSpeed !== null
                          ? `${loc.windSpeed.toFixed(0)} km/h`
                          : ''}
                      </span>
                      <span className="font-medium text-slate-100">
                        {loc.temperature !== null
                          ? `${loc.temperature.toFixed(1)}°`
                          : loc.status === 'error'
                            ? 'Err'
                            : '…'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
