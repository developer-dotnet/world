export interface ThermalStop {
  temp: number;
  rgb: [number, number, number];
  label: string;
}

export const THERMAL_STOPS: ThermalStop[] = [
  { temp: -25, rgb: [30, 58, 138], label: '-25°' },   // Deep Arctic Indigo
  { temp: -12, rgb: [37, 99, 235], label: '-12°' },   // Glacial Cobalt
  { temp: 0, rgb: [6, 182, 212], label: '0°' },       // Frost Cyan
  { temp: 12, rgb: [16, 185, 129], label: '12°' },    // Cool Emerald
  { temp: 22, rgb: [234, 179, 8], label: '22°' },     // Mild Gold
  { temp: 32, rgb: [249, 115, 22], label: '32°' },    // Warm Amber
  { temp: 44, rgb: [220, 38, 38], label: '44°' },     // Torrid Crimson
];

export const THERMAL_MIN_C = -25;
export const THERMAL_MAX_C = 44;

export function sampleThermalRGB(tempC: number): [number, number, number] {
  if (tempC <= THERMAL_STOPS[0].temp) {
    return THERMAL_STOPS[0].rgb;
  }
  const last = THERMAL_STOPS[THERMAL_STOPS.length - 1];
  if (tempC >= last.temp) {
    return last.rgb;
  }

  for (let i = 0; i < THERMAL_STOPS.length - 1; i++) {
    const a = THERMAL_STOPS[i];
    const b = THERMAL_STOPS[i + 1];
    if (tempC >= a.temp && tempC <= b.temp) {
      const t = (tempC - a.temp) / (b.temp - a.temp);
      return [
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t),
      ];
    }
  }
  return last.rgb;
}

export function sampleThermalCss(tempC: number, alpha = 1): string {
  const [r, g, b] = sampleThermalRGB(tempC);
  if (alpha >= 1) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function sampleThermalHex(tempC: number): number {
  const [r, g, b] = sampleThermalRGB(tempC);
  return (r << 16) | (g << 8) | b;
}

export function getThermalGradientCss(): string {
  const stops = THERMAL_STOPS.map((stop) => {
    const pct = ((stop.temp - THERMAL_MIN_C) / (THERMAL_MAX_C - THERMAL_MIN_C)) * 100;
    return `rgb(${stop.rgb[0]}, ${stop.rgb[1]}, ${stop.rgb[2]}) ${pct.toFixed(1)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
