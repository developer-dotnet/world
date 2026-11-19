import { getThermalGradientCss } from '../utils/temperatureScale';

interface ThermalScaleLegendProps {
  activeTemp?: number | null;
}

const SCALE_TICKS = [
  { temp: -20, label: '-20°' },
  { temp: 0, label: '0°' },
  { temp: 15, label: '15°' },
  { temp: 30, label: '30°' },
  { temp: 44, label: '44°C' },
];

export function ThermalScaleLegend({ activeTemp }: ThermalScaleLegendProps) {
  const markerPct =
    activeTemp !== null && activeTemp !== undefined
      ? Math.max(0, Math.min(100, ((activeTemp - -25) / (44 - -25)) * 100))
      : null;

  return (
    <div className="border border-slate-800/90 bg-[#0B101A]/90 px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-4 text-[11px] text-slate-400">
        <span className="font-medium text-slate-200">Thermal Scale</span>
        <span className="font-mono tabular-nums text-slate-400">
          Cold → Warm
        </span>
      </div>

      <div className="relative mt-2 h-2.5 w-52 overflow-visible sm:w-60">
        <div
          className="h-full w-full"
          style={{ background: getThermalGradientCss() }}
        />
        {markerPct !== null && (
          <div
            className="absolute -top-1 h-4.5 w-0.5 bg-white shadow-[0_0_4px_rgba(255,255,255,0.9)]"
            style={{ left: `${markerPct}%` }}
          />
        )}
      </div>

      <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] tabular-nums text-slate-400">
        {SCALE_TICKS.map((tick) => (
          <span key={tick.label}>{tick.label}</span>
        ))}
      </div>
    </div>
  );
}
