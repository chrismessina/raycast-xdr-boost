export interface Level {
  name: string;
  value: number;
}

/** Off plus four preset boost levels, evenly spaced up to 1.75 (Headroom's levels). */
export const LEVELS: readonly Level[] = [
  { name: "Off", value: 1.0 },
  { name: "Low", value: 1.1875 },
  { name: "Medium", value: 1.375 },
  { name: "High", value: 1.5625 },
  { name: "Max", value: 1.75 },
];

export const OFF = 1.0;
export const MAX = 1.75;

/**
 * Numeric noise only. Levels travel TS → JSON → Swift Double → JSON → TS unchanged, so equality is
 * exact in practice; this must stay far below any level a person can type (1.0005 is a real level).
 */
export const EPSILON = 1e-9;

const PREFERENCE_KEYS: Record<string, number> = { low: 1, medium: 2, high: 3, max: 4 };

/** The `defaultLevel` preference value ("low" … "max") as a level; unknown values fall back to High. */
export function levelFromPreference(key: string | undefined): Level {
  return LEVELS[PREFERENCE_KEYS[key ?? ""] ?? 3];
}

/** Any level clamped to Off … Max. Not snapped to a preset: arbitrary levels are allowed. */
export function clampLevel(value: number): number {
  return Math.min(Math.max(value, OFF), MAX);
}

/** The preset exactly at `value`, if there is one. Off means 1.0 or below, nothing else. */
export function presetAt(value: number | undefined): Level | undefined {
  if (value === undefined || value <= OFF) return LEVELS[0];
  return LEVELS.slice(1).find((level) => Math.abs(level.value - value) < EPSILON);
}

/** Index of the preset nearest to `value`, for the five-state menu bar icon. Anything ≤ 1.0 is Off. */
export function indexOfLevel(value: number | undefined): number {
  if (value === undefined || value <= OFF) return 0;
  let best = 0;
  for (let i = 1; i < LEVELS.length; i++) {
    if (Math.abs(LEVELS[i].value - value) < Math.abs(LEVELS[best].value - value)) best = i;
  }
  return best;
}

/** The next preset strictly above (+1) or below (-1) `value`, clamped to Off … Max. */
export function stepLevel(value: number | undefined, direction: 1 | -1): Level {
  const v = value === undefined ? OFF : clampLevel(value);
  if (direction === 1) return LEVELS.find((level) => level.value > v + EPSILON) ?? LEVELS[LEVELS.length - 1];
  return [...LEVELS].reverse().find((level) => level.value < v - EPSILON) ?? LEVELS[0];
}

/** "High 1.56", "Off", or "Custom 1.50" for a level between presets. */
export function levelLabel(value: number): string {
  const preset = presetAt(value);
  if (preset) return preset.value <= OFF ? preset.name : `${preset.name} ${preset.value.toFixed(2)}`;
  // Two decimals like the presets, unless that would hide the value (1.0005 must not read "1.00").
  const short = value.toFixed(2);
  const exact = String(Number(value.toFixed(4)));
  return `Custom ${Number(short) === Number(exact) ? short : exact}`;
}

/**
 * Parses what a person (or a model) types: a preset name ("high", "off"), a level ("1.5"),
 * or a percent of the way from Off to Max ("50%" = halfway, 1.375). Levels are positions on that scale:
 * how much brighter a position looks depends on the display and its brightness setting. Returns undefined
 * when the input is none of those or lies outside Off … Max.
 */
export function parseLevel(input: string): number | undefined {
  const text = input.trim().toLowerCase();
  if (!text) return undefined;
  const preset = LEVELS.find((level) => level.name.toLowerCase() === text);
  if (preset) return preset.value;
  const percent = /^(\d+(?:\.\d+)?)\s*%$/.exec(text);
  const value = percent ? OFF + (Number(percent[1]) / 100) * (MAX - OFF) : Number(text);
  if (!Number.isFinite(value) || value < OFF || value > MAX) return undefined;
  return value;
}
