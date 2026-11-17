// Forecast a big game launch's Twitch concurrent viewers, hour by hour.
//
// The model learns the shape of a launch day from the case's own comparables.
// For every past launch it takes the release-day hourly curve and divides it
// by that launch's first hour, so each launch contributes a curve of
// log-ratios: how the day ramps, dips and peaks relative to its first hour.
// Launches that resemble this one count more: console-only, rolling-midnight
// releases with no early access, and the cleanest tier of the set. The
// forecast for each hour is the weighted median of those log-ratios, anchored
// on this case's hour-1 print, with a spread taken from the weighted
// interquartile range of the same ratios, so the band widens exactly where
// past launches disagree about that hour. The anchor carries the scale (a
// bigger launch starts bigger); the ratios carry the shape (the night dip,
// the US unlock ramp, the evening peak, the late fade).
//
// The program reads every <id>.in in the input directory and writes one
// <id>.out per case: {"hours":[{"hour":2,"q":[q05,q25,q50,q75,q95]}, ...]}.
// Standard library only, no network, no randomness and no clock, so two runs
// write identical bytes.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Quantile levels, in the order each output row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** Standard normal quantiles at the levels above. */
const Z = [-1.6448536269514722, -0.6744897501960817, 0, 0.6744897501960817, 1.6448536269514722];
/** Narrowest and widest log-spread a forecast hour may carry. */
const MIN_SPREAD = 0.12;
const MAX_SPREAD = 1.0;
/** A median hour never claims more than this many times the first hour. */
const MAX_MEDIAN_RATIO = 3.0;
/** Extra weight for rolling-midnight, console-only launches. */
const ROLLING_CONSOLE_BOOST = 1.5;
/** A fallback spread when too few comparables cover an hour. */
const THIN_SPREAD = 0.35;

interface HourlyPoint {
  from: string;
  viewers: number | null;
  channels?: number | null;
}

interface Comparable {
  name: string;
  day_start: string;
  unlock?: string;
  platforms?: string;
  hourly: HourlyPoint[];
}

interface CaseFile {
  id: string;
  game: { name: string; twitch_id?: string };
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  history_hourly?: Array<{ from: string; viewers: number | null }>;
  comparables?: Comparable[];
  notes?: string;
}

/** x rounded to 2 decimals (half up). */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Milliseconds since the epoch for an ISO 8601 timestamp. */
const toMs = (iso: string): number => Date.parse(iso);

/**
 * A comparable's release-day hourly viewers, 24 slots, hour 1 first.
 * A slot stays null when the source sampled no point in that hour.
 */
const releaseDay = (c: Comparable): Array<number | null> => {
  const start = toMs(c.day_start);
  const day: Array<number | null> = new Array(24).fill(null);
  if (!Number.isFinite(start)) return day;
  for (const p of c.hourly ?? []) {
    if (typeof p.viewers !== 'number' || !Number.isFinite(p.viewers) || p.viewers <= 0) continue;
    const k = Math.floor((toMs(p.from) - start) / 3_600_000);
    if (k >= 0 && k < 24) day[k] = p.viewers;
  }
  return day;
};

/** How many of the day's 24 hours a curve actually covers. */
const coveredHours = (day: Array<number | null>): number => day.filter((v) => v !== null).length;

/**
 * Whether the target launch unlocks on a rolling midnight, read from the
 * case notes: true for rolling midnight local, false for a single simultaneous
 * global unlock, null when the notes say neither.
 */
const targetIsRolling = (notes: string | undefined): boolean | null => {
  const n = (notes ?? '').toLowerCase();
  if (n.includes('rolling midnight') || n.includes('midnight local')) return true;
  if (n.includes('single global') || n.includes('simultaneous')) return false;
  return null;
};

/**
 * A comparable's weight. The tier in its unlock note decides the base
 * (clean comparables count fully, early-access ones a third, weak ones are
 * dropped by the caller), the unlock pattern decides the next factor
 * (launches that unlock the way the target does count fully), and
 * rolling-midnight console-only launches get a boost: they are the closest
 * shape to a console-only rolling launch.
 */
const comparableWeight = (c: Comparable, rollingTarget: boolean | null): number => {
  const note = (c.unlock ?? '').toLowerCase();
  let tier = 'comparable';
  if (note.includes('tier:')) tier = note.split('tier:')[1].split('.')[0].trim();
  let w = tier.startsWith('early') ? 0.3 : tier.startsWith('weak') ? 0 : 0.5;
  if (tier.startsWith('comparable')) w = 1.0;
  const rolling = note.includes('midnight local') || note.includes('rolling');
  const simultaneous = note.includes('single global') || note.includes('simultaneous');
  if (rollingTarget === true) w *= rolling ? 1.0 : simultaneous ? 0.3 : 0.6;
  else if (rollingTarget === false) w *= simultaneous ? 1.0 : rolling ? 0.3 : 0.6;
  else w *= rolling ? 0.8 : 0.6;
  const platforms = c.platforms ?? '';
  if (rolling && !platforms.includes('PC')) w *= ROLLING_CONSOLE_BOOST;
  return w;
};

/** The value at which the cumulative weight first reaches a share q of the total. */
const weightedQuantile = (pairs: Array<[number, number]>, q: number): number => {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return sorted.length ? sorted[Math.floor(sorted.length / 2)][0] : 0;
  let acc = 0;
  for (const [v, w] of sorted) {
    acc += w;
    if (acc >= total * q) return v;
  }
  return sorted[sorted.length - 1][0];
};

/** The weighted median of log-ratios. */
const weightedMedian = (pairs: Array<[number, number]>): number => weightedQuantile(pairs, 0.5);

/** The log-spread of a set of log-ratios, from its weighted interquartile range. */
const spreadOf = (pairs: Array<[number, number]>): number => {
  const iqr = weightedQuantile(pairs, 0.75) - weightedQuantile(pairs, 0.25);
  return Math.min(MAX_SPREAD, Math.max(MIN_SPREAD, iqr / 1.349));
};

/** Hour 1's print, the anchor of the whole forecast (a print below 1 counts as 1). */
const anchorOf = (c: CaseFile): number => {
  const first = (c.known ?? []).find((k) => k.hour === 1);
  if (first && Number.isFinite(first.viewers) && first.viewers > 0) return Math.max(1, first.viewers);
  const hist = c.history_hourly ?? [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const v = hist[i]?.viewers;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.max(1, v);
  }
  return 1;
};

/** The five quantiles of one hour, around its median, at the hour's spread. */
const hourQuantiles = (median: number, spread: number): number[] => {
  const q = Z.map((z) => median * Math.exp(z * spread));
  const out = q.map((v) => Math.min(1_000_000_000, Math.max(1, round2(v))));
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1]);
  return out;
};

/** Forecast every hour the case asks for, from the comparables' log-ratio curves. */
const forecastCase = (c: CaseFile): Array<{ hour: number; q: number[] }> => {
  const p = anchorOf(c);
  const target = (c.game?.name ?? '').toLowerCase();
  const rollingTarget = targetIsRolling(c.notes);
  const pool: Array<{ day: Array<number | null>; weight: number }> = [];
  for (const comp of c.comparables ?? []) {
    const note = (comp.unlock ?? '').toLowerCase();
    if (note.includes('not a launch')) continue; // the target's own pre-launch history
    if (comp.name.toLowerCase() === target) continue; // the target itself
    const day = releaseDay(comp);
    if (!day[0] || coveredHours(day) < 12) continue; // needs a real first hour and day
    const w = comparableWeight(comp, rollingTarget);
    if (w <= 0) continue;
    pool.push({ day, weight: w });
  }
  const rows: Array<{ hour: number; q: number[] }> = [];
  let lastMedianLog = 0;
  // The hours the case asks for (2..24); default to the full day if the
  // list is missing, so a malformed case still yields a valid forecast.
  const hoursToForecast = (c.forecast ?? []).length > 0
    ? c.forecast
    : Array.from({ length: 23 }, (_, i) => ({ hour: i + 2 }));
  for (const { hour } of hoursToForecast) {
    const h = hour - 1; // hour 2 is index 1 of the release day
    const pairs: Array<[number, number]> = [];
    for (const { day, weight } of pool) {
      if (day[h] !== null && day[0] !== null) pairs.push([Math.log(day[h] as number / (day[0] as number)), weight]);
    }
    let medianLog: number;
    let spread: number;
    if (pairs.length >= 3) {
      medianLog = Math.min(Math.log(MAX_MEDIAN_RATIO), weightedMedian(pairs));
      spread = spreadOf(pairs);
    } else {
      medianLog = lastMedianLog; // too few launches cover this hour: hold the shape
      spread = THIN_SPREAD;
    }
    lastMedianLog = medianLog;
    rows.push({ hour, q: hourQuantiles(p * Math.exp(medianLog), spread) });
  }
  return rows;
};

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as CaseFile;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const hours = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
