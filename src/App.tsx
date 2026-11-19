import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  FileJson,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { ConfigModal } from './components/ConfigModal';
import {
  GlobeViewport,
  type GlobeViewportHandle,
  zoomLevelToDistance,
} from './components/GlobeViewport';
import { InspectorPanel } from './components/InspectorPanel';
import { ThermalScaleLegend } from './components/ThermalScaleLegend';
import {
  buildInitialAggregates,
  fetchAllWeatherReadings,
  loadWeatherConfig,
} from './services/weatherService';
import type {
  AggregationMode,
  CountryWeatherAggregate,
  LocationWeatherReading,
  WeatherWorldConfig,
} from './types/weather';
import {
  type CountryPolygonFeature,
  getWorldCountryFeatures,
  resolveCountryFeature,
} from './utils/worldGeo';

export function App() {
  const globeRef = useRef<GlobeViewportHandle | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);

  const [config, setConfig] = useState<WeatherWorldConfig | null>(null);
  const [aggregates, setAggregates] = useState<CountryWeatherAggregate[]>([]);
  const [configError, setConfigError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const [zoomLevel, setZoomLevel] = useState(80);
  const [cameraDistance, setCameraDistance] = useState(5.45);
  const [isLocalMode, setIsLocalMode] = useState(false);
  const [modeOverride, setModeOverride] = useState<AggregationMode>('auto');

  const [hoveredCountryISO, setHoveredCountryISO] = useState<string | null>(null);
  const [hoveredFeature, setHoveredFeature] =
    useState<CountryPolygonFeature | null>(null);
  const [selectedCountryISO, setSelectedCountryISO] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] =
    useState<CountryPolygonFeature | null>(null);

  const [hoveredLocation, setHoveredLocation] =
    useState<LocationWeatherReading | null>(null);
  const [selectedLocation, setSelectedLocation] =
    useState<LocationWeatherReading | null>(null);

  const [dockOpen, setDockOpen] = useState(true);
  const [configModalOpen, setConfigModalOpen] = useState(false);

  const features = useMemo(() => getWorldCountryFeatures(), []);

  const runWeatherFetch = useCallback((targetConfig: WeatherWorldConfig) => {
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    const initial = buildInitialAggregates(targetConfig);
    setAggregates(initial);
    setIsFetching(true);

    fetchAllWeatherReadings(
      initial,
      (updated) => {
        if (!controller.signal.aborted) {
          setAggregates(updated);
        }
      },
      controller.signal,
    )
      .catch(() => {
        // Individual location errors are surfaced per reading
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsFetching(false);
        }
      });
  }, []);

  const loadDefaultConfig = useCallback(async () => {
    setConfigError(null);
    try {
      const loaded = await loadWeatherConfig();
      setConfig(loaded);
      runWeatherFetch(loaded);
    } catch (err) {
      setConfigError(
        err instanceof Error ? err.message : 'Unable to load weather-config.json',
      );
    }
  }, [runWeatherFetch]);

  useEffect(() => {
    loadDefaultConfig();
    return () => {
      fetchAbortRef.current?.abort();
    };
  }, [loadDefaultConfig]);

  // Keyboard shortcut H to toggle bottom control dock
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === 'h' &&
        !configModalOpen &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA' &&
        document.activeElement?.tagName !== 'SELECT'
      ) {
        setDockOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [configModalOpen]);

  const handleZoomChange = useCallback(
    (nextZoom: number, nextDist: number, local: boolean) => {
      setZoomLevel(nextZoom);
      setCameraDistance(nextDist);
      setIsLocalMode(local);
    },
    [],
  );

  const handleHoverCountry = useCallback(
    (iso: string | null, feature: CountryPolygonFeature | null) => {
      setHoveredCountryISO(iso);
      setHoveredFeature(feature);
    },
    [],
  );

  const handleSelectCountry = useCallback(
    (iso: string | null, feature: CountryPolygonFeature | null) => {
      setSelectedCountryISO(iso);
      setSelectedFeature(feature);
    },
    [],
  );

  const handleJumpToCountry = (iso: string) => {
    if (!iso) return;
    const agg = aggregates.find((a) => a.ISO === iso);
    if (!agg) return;

    const feat = resolveCountryFeature(agg.ISO, agg.name, features) ?? null;
    setSelectedCountryISO(agg.ISO);
    setSelectedFeature(feat);
    setSelectedLocation(null);

    if (feat) {
      globeRef.current?.flyToLatLon(
        feat.centroid.lat,
        feat.centroid.lon,
        Math.min(cameraDistance, 4.5),
      );
    } else if (agg.locations.length > 0) {
      globeRef.current?.flyToLatLon(
        agg.locations[0].latitude,
        agg.locations[0].longitude,
        4.3,
      );
    }
  };

  const handleFocusLocation = (loc: LocationWeatherReading) => {
    setSelectedLocation(loc);
    setSelectedCountryISO(loc.countryISO);

    const threshold = config?.zoomAggregate ?? 120;
    const targetDist =
      threshold <= 15
        ? Math.max(2.5, threshold - 0.55)
        : zoomLevelToDistance(Math.min(185, threshold + 30));
    globeRef.current?.flyToLatLon(loc.latitude, loc.longitude, targetDist);
  };

  // Resolve active country & location for InspectorPanel (hovered takes priority if nothing pinned, or hovered previews live)
  const displayCountryISO = hoveredCountryISO ?? selectedCountryISO;
  const displayFeature = hoveredCountryISO ? hoveredFeature : selectedFeature;
  const displayAggregate = useMemo(
    () => aggregates.find((a) => a.ISO === displayCountryISO) ?? null,
    [aggregates, displayCountryISO],
  );
  const displayLocation = hoveredLocation ?? selectedLocation;

  const liveStationSummary = useMemo(() => {
    let live = 0;
    let total = 0;
    for (const c of aggregates) {
      live += c.liveCount;
      total += c.totalCount;
    }
    return { live, total };
  }, [aggregates]);

  const activeScaleTemp =
    displayLocation?.temperature ?? displayAggregate?.avgTemperature ?? null;

  const zoomAggregate = config?.zoomAggregate ?? 120;
  const isDistanceThreshold = zoomAggregate <= 15;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#07090E] text-slate-100">
      {/* Full-viewport 3D Globe */}
      <GlobeViewport
        ref={globeRef}
        aggregates={aggregates}
        zoomAggregate={zoomAggregate}
        modeOverride={modeOverride}
        selectedCountryISO={selectedCountryISO}
        hoveredCountryISO={hoveredCountryISO}
        selectedLocationKey={selectedLocation?.key ?? null}
        onZoomChange={handleZoomChange}
        onHoverCountry={handleHoverCountry}
        onSelectCountry={handleSelectCountry}
        onHoverLocation={setHoveredLocation}
        onSelectLocation={setSelectedLocation}
      />

      {/* Top HUD Overlay */}
      <header className="pointer-events-none fixed inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-4 p-4 sm:p-5">
        <div className="pointer-events-auto border border-slate-800/90 bg-[#0B101A]/90 px-4 py-2.5">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-base font-semibold tracking-tight text-slate-50 whitespace-nowrap">
              World Thermal Globe
            </h1>
            <span className="text-xs text-slate-500" aria-hidden="true">
              ·
            </span>
            <span className="text-xs font-medium text-cyan-400 whitespace-nowrap">
              {isLocalMode
                ? 'Local Lat/Lon Thermal Circles'
                : 'Country Average Mode'}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 font-mono text-[11px] tabular-nums text-slate-400">
            <span>{aggregates.length} countries</span>
            <span aria-hidden="true">·</span>
            <span>
              {liveStationSummary.live}/{liveStationSummary.total} stations live
            </span>
            {isFetching && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-slate-300">Updating…</span>
              </>
            )}
          </div>
        </div>

        <div className="pointer-events-auto flex flex-wrap items-start gap-2.5">
          <ThermalScaleLegend activeTemp={activeScaleTemp} />

          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setConfigModalOpen(true)}
              className="inline-flex items-center justify-center gap-1.5 border border-slate-800 bg-[#0B101A]/90 px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-700 hover:bg-slate-900 whitespace-nowrap shrink-0"
            >
              <FileJson className="h-3.5 w-3.5 text-cyan-400" />
              JSON Config
            </button>
            <button
              type="button"
              onClick={() => config && runWeatherFetch(config)}
              disabled={!config || isFetching}
              className="inline-flex items-center justify-center gap-1.5 border border-slate-800 bg-[#0B101A]/90 px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-700 hover:bg-slate-900 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`}
              />
              Refresh Weather
            </button>
          </div>
        </div>
      </header>

      {/* Config Load Error */}
      {configError && (
        <div className="pointer-events-auto fixed left-4 top-24 z-20 max-w-sm border border-rose-500/40 bg-rose-950/90 px-4 py-3 text-xs text-rose-100">
          <div className="font-semibold">Configuration Error</div>
          <p className="mt-1 text-rose-200">{configError}</p>
        </div>
      )}

      {/* Left Inspector Panel (only visible when hovering/selecting a country or station) */}
      <div className="pointer-events-none fixed bottom-24 left-4 z-20 sm:left-5">
        <InspectorPanel
          countryAggregate={displayAggregate}
          unconfiguredCountryName={
            !displayAggregate && displayFeature ? displayFeature.name : null
          }
          activeLocation={displayLocation}
          isLocalMode={isLocalMode}
          isPinned={Boolean(selectedCountryISO || selectedLocation)}
          onSelectLocation={handleFocusLocation}
          onClearSelection={() => {
            setSelectedCountryISO(null);
            setSelectedFeature(null);
            setSelectedLocation(null);
          }}
        />
      </div>

      {/* Collapsible Bottom Control Dock */}
      <div
        className={`pointer-events-none fixed bottom-4 left-1/2 z-20 w-[min(900px,94vw)] -translate-x-1/2 transition-transform duration-200 ${
          dockOpen ? 'translate-y-0' : 'translate-y-[calc(100%-30px)]'
        }`}
      >
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setDockOpen((prev) => !prev)}
            className="pointer-events-auto inline-flex items-center gap-1.5 border border-b-0 border-slate-800 bg-[#0B101A]/95 px-3 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:text-white whitespace-nowrap"
          >
            {dockOpen ? (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                Hide Controls
              </>
            ) : (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                Show Controls
              </>
            )}
          </button>
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center justify-between gap-3 border border-slate-800/95 bg-[#0B101A]/94 px-4 py-2.5">
          {/* Zoom Meter + Threshold Readout */}
          <div className="flex items-center gap-3">
            <div className="text-xs">
              <div className="text-[11px] text-slate-400">
                {isDistanceThreshold ? 'Camera Distance' : 'Zoom Level'}
              </div>
              <div className="font-mono text-xs font-medium tabular-nums text-slate-100">
                {isDistanceThreshold
                  ? `${cameraDistance.toFixed(2)} / ${zoomAggregate.toFixed(2)}`
                  : `${zoomLevel} / ${zoomAggregate}`}
              </div>
            </div>

            <div className="flex items-center border border-slate-800 bg-slate-900">
              <button
                type="button"
                onClick={() => globeRef.current?.setZoomDelta(-28)}
                className="px-2.5 py-1.5 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                aria-label="Zoom out"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => globeRef.current?.setZoomDelta(28)}
                className="border-x border-slate-800 px-2.5 py-1.5 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                aria-label="Zoom in"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => globeRef.current?.resetView()}
                className="px-2.5 py-1.5 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                aria-label="Reset globe view"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Mode Selector */}
          <div className="flex items-center gap-1 border border-slate-800 bg-slate-900 p-0.5">
            {(
              [
                { id: 'auto', label: 'Auto (Zoom)' },
                { id: 'country', label: 'Country Avg' },
                { id: 'local', label: 'Local Circles' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setModeOverride(opt.id)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  modeOverride === opt.id
                    ? 'bg-cyan-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Country Quick-Jump */}
          <div className="flex items-center gap-2">
            <label
              htmlFor="country-jump-select"
              className="text-xs text-slate-400 whitespace-nowrap"
            >
              Country
            </label>
            <select
              id="country-jump-select"
              value={selectedCountryISO ?? ''}
              onChange={(e) => handleJumpToCountry(e.target.value)}
              className="border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
            >
              <option value="">Jump to country…</option>
              {aggregates.map((c) => (
                <option key={c.ISO} value={c.ISO}>
                  {c.name} ({c.ISO})
                  {c.avgTemperature !== null
                    ? ` · ${c.avgTemperature.toFixed(1)}°C`
                    : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Live JSON Config Editor Modal */}
      <ConfigModal
        open={configModalOpen}
        config={config}
        onClose={() => setConfigModalOpen(false)}
        onApplyConfig={(next) => {
          setConfig(next);
          setSelectedCountryISO(null);
          setSelectedFeature(null);
          setSelectedLocation(null);
          runWeatherFetch(next);
        }}
        onResetDefault={loadDefaultConfig}
      />
    </div>
  );
}

export default App;
