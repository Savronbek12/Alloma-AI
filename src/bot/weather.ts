import type { RequestHandler } from "express";
import { findRegion, type Region } from "../../shared/regions.js";

/**
 * Vaqt va ob-havo: Open-Meteo (bepul, API kalitsiz) orqali.
 * Standart shahar — Toshkent; "ob-havo Samarqand" kabi shahar nomi ham qabul qilinadi.
 */

export const TIME_BUTTON = "🕒 Vaqt";
export const WEATHER_BUTTON = "🌤 Ob-havo";

export const DEFAULT_TIMEZONE = "Asia/Tashkent";

export interface Place {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export const TASHKENT: Place = { name: "Toshkent", latitude: 41.2995, longitude: 69.2401, timezone: DEFAULT_TIMEZONE };

export interface WeatherNow {
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  code: number;
  isDay: boolean;
  todayMax?: number | undefined;
  todayMin?: number | undefined;
  /** Kunlik prognoz: [0] — bugun, [1] — ertaga, [2] — indinga. */
  days?: DayForecast[] | undefined;
}

export interface DayForecast {
  /** "2026-11-06" (shahar vaqt mintaqasida). */
  date: string;
  code: number;
  min: number;
  max: number;
  /** Yog'in ehtimoli, % (ma'lum bo'lmasa — undefined). */
  rainChance?: number | undefined;
}

export const FORECAST_DAYS = 3;

export interface WeatherClient {
  geocode(query: string): Promise<Place | undefined>;
  current(place: Place): Promise<WeatherNow>;
}

type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class OpenMeteoClient implements WeatherClient {
  private readonly cache = new Map<string, { at: number; data: WeatherNow }>();

  constructor(
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
    private readonly cacheMs = 10 * 60_000,
  ) {}

  private async getJson<T>(url: string): Promise<T> {
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async geocode(query: string): Promise<Place | undefined> {
    const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&language=uz&format=json&name=${encodeURIComponent(query)}`;
    const data = await this.getJson<{
      results?: { name: string; latitude: number; longitude: number; timezone?: string }[];
    }>(url);
    const r = data.results?.[0];
    if (!r) return undefined;
    return { name: r.name, latitude: r.latitude, longitude: r.longitude, timezone: r.timezone ?? DEFAULT_TIMEZONE };
  }

  async current(place: Place): Promise<WeatherNow> {
    const key = `${place.latitude.toFixed(2)},${place.longitude.toFixed(2)}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.cacheMs) return cached.data;

    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
      `&forecast_days=${FORECAST_DAYS}&wind_speed_unit=ms` +
      `&timezone=${encodeURIComponent(place.timezone)}`;
    const data = await this.getJson<{
      current: {
        temperature_2m: number;
        apparent_temperature: number;
        relative_humidity_2m: number;
        wind_speed_10m: number;
        weather_code: number;
        is_day: number;
      };
      daily?: {
        time?: string[];
        weather_code?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: (number | null)[];
      };
    }>(url);
    const c = data.current;
    const d = data.daily;
    const days: DayForecast[] = (d?.time ?? []).flatMap((date, i) => {
      const code = d?.weather_code?.[i];
      const min = d?.temperature_2m_min?.[i];
      const max = d?.temperature_2m_max?.[i];
      if (code == null || min == null || max == null) return [];
      return [{ date, code, min, max, rainChance: d?.precipitation_probability_max?.[i] ?? undefined }];
    });
    const result: WeatherNow = {
      temperature: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      windSpeed: c.wind_speed_10m,
      code: c.weather_code,
      isDay: c.is_day === 1,
      todayMax: data.daily?.temperature_2m_max?.[0],
      todayMin: data.daily?.temperature_2m_min?.[0],
      days,
    };
    this.cache.set(key, { at: Date.now(), data: result });
    return result;
  }
}

/** WMO ob-havo kodlari → emoji va o'zbekcha tavsif. */
export function describeWeather(code: number, isDay = true): { emoji: string; text: string } {
  if (code === 0) return isDay ? { emoji: "☀️", text: "Ochiq osmon" } : { emoji: "🌙", text: "Ochiq osmon" };
  if (code === 1 || code === 2) return { emoji: isDay ? "🌤" : "☁️", text: "Qisman bulutli" };
  if (code === 3) return { emoji: "☁️", text: "Bulutli" };
  if (code === 45 || code === 48) return { emoji: "🌫", text: "Tuman" };
  if (code >= 51 && code <= 57) return { emoji: "🌦", text: "Mayda yomg'ir" };
  if (code >= 61 && code <= 67) return { emoji: "🌧", text: "Yomg'ir" };
  if (code >= 71 && code <= 77) return { emoji: "🌨", text: "Qor" };
  if (code >= 80 && code <= 82) return { emoji: "🌦", text: "Jala" };
  if (code === 85 || code === 86) return { emoji: "🌨", text: "Qor yog'ishi" };
  if (code >= 95) return { emoji: "⛈", text: "Momaqaldiroq" };
  return { emoji: "🌡", text: "Ob-havo" };
}

const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
const MONTHS = [
  "yanvar", "fevral", "mart", "aprel", "may", "iyun",
  "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr",
];

/** Berilgan vaqt mintaqasidagi sana/vaqt qismlari. */
function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: get("hour"),
    minute: get("minute"),
    weekday: WEEKDAYS[weekdayIndex] ?? "",
  };
}

/** "🕒 Toshkent vaqti: 14:05\n📅 Payshanba, 5-noyabr 2026-yil" */
export function formatTime(date: Date, place: Pick<Place, "name" | "timezone"> = TASHKENT): string {
  const p = zonedParts(date, place.timezone);
  return [
    `🕒 <b>${place.name}</b> vaqti: <b>${p.hour}:${p.minute}</b>`,
    `📅 ${p.weekday}, ${p.day}-${MONTHS[p.month - 1]} ${p.year}-yil`,
  ].join("\n");
}

const round = (n: number) => Math.round(n);
const signed = (n: number) => `${round(n) > 0 ? "+" : ""}${round(n)}`;

export function formatWeather(place: Place, w: WeatherNow): string {
  const d = describeWeather(w.code, w.isDay);
  const lines = [
    `${d.emoji} <b>${place.name}</b> — ${d.text}`,
    `🌡 Harorat: <b>${signed(w.temperature)}°C</b> (sezilishi ${signed(w.feelsLike)}°C)`,
  ];
  if (w.todayMin !== undefined && w.todayMax !== undefined) {
    lines.push(`📈 Bugun: ${signed(w.todayMin)}° … ${signed(w.todayMax)}°C`);
  }
  lines.push(`💧 Namlik: ${round(w.humidity)}%`, `💨 Shamol: ${round(w.windSpeed)} m/s`);

  const ahead = (w.days ?? []).slice(1, FORECAST_DAYS);
  if (ahead.length > 0) {
    lines.push("", "<b>📅 Prognoz:</b>");
    ahead.forEach((day, i) => lines.push(formatDay(day, i === 0 ? "Ertaga" : "Indinga")));
  }
  return lines.join("\n");
}

/** "🌧 <b>Ertaga</b>, 6-noyabr: +8° … +15°C, yomg'ir (☔ 70%)" */
export function formatDay(day: DayForecast, label: string): string {
  const d = describeWeather(day.code, true);
  const [, month = "1", date = "1"] = day.date.split("-");
  const rain = day.rainChance !== undefined && day.rainChance >= 20 ? ` (☔ ${round(day.rainChance)}%)` : "";
  return `${d.emoji} <b>${label}</b>, ${Number(date)}-${MONTHS[Number(month) - 1]}: ${signed(day.min)}° … ${signed(day.max)}°C, ${d.text.toLowerCase()}${rain}`;
}

const APOSTROPHES = /[ʻʼ‘’`']/g;

/** Matn vaqt so'rovi bo'lsa — true ("soat necha?", "hozir vaqt qancha"). */
export function isTimeQuestion(text: string): boolean {
  const t = text.toLowerCase().replace(APOSTROPHES, "'").trim();
  if (t.length > 60) return false;
  return /\bsoat\s+(necha|nechchi|qancha|nech)\b/.test(t) || /\bvaqt\s+(necha|qancha|bo'ldi)\b/.test(t) || /^(vaqt|soat)\s*\??$/.test(t);
}

/**
 * Ob-havo so'rovi bo'lsa — shahar nomi (bo'sh satr = standart shahar), aks holda undefined.
 * "ob-havo", "Samarqandda ob havo qanday?", "ob-havo Buxoro".
 */
export function parseWeatherRequest(text: string): string | undefined {
  const t = text.replace(APOSTROPHES, "'").trim();
  if (t.length > 80) return undefined;
  const m = t.match(/ob[\s-]*havo/i);
  if (!m || m.index === undefined) return undefined;
  const before = t.slice(0, m.index);
  const after = t.slice(m.index + m[0].length);
  const cleanup = (s: string) =>
    s
      .replace(/[?!.,]/g, " ")
      .replace(/\b(qanday|qanaqa|qalay|bugun|hozir|ertaga|ma'lumot|haqida|aytib\s+ber|aytchi|ayt|bo'ladi)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  // "Samarqandda ob-havo" → "Samarqand"
  const city = cleanup(before).replace(/(?<=\S{3})(da|dagi)$/i, "") || cleanup(after);
  return city.length >= 2 ? city : "";
}

// ---------- Mini App: viloyat bo'yicha ob-havo API'si ----------

export const MINIAPP_WEATHER_PATH = "/api/miniapp/weather";

/** Mini App'dagi ob-havo ekrani uchun javob (matnlar serverda tayyorlanadi). */
export interface WeatherResponse {
  region: string;
  city: string;
  current: { temperature: number; feelsLike: number; humidity: number; windSpeed: number; emoji: string; text: string };
  days: { label: string; date: string; min: number; max: number; rainChance?: number | undefined; emoji: string; text: string }[];
}

export function toWeatherResponse(region: Region, w: WeatherNow): WeatherResponse {
  const now = describeWeather(w.code, w.isDay);
  const labels = ["Bugun", "Ertaga", "Indinga"];
  return {
    region: region.name,
    city: region.city,
    current: {
      temperature: Math.round(w.temperature),
      feelsLike: Math.round(w.feelsLike),
      humidity: Math.round(w.humidity),
      windSpeed: Math.round(w.windSpeed),
      ...now,
    },
    days: (w.days ?? []).slice(0, FORECAST_DAYS).map((d, i) => {
      const [, month = "1", day = "1"] = d.date.split("-");
      return {
        label: labels[i] ?? "",
        date: `${Number(day)}-${MONTHS[Number(month) - 1]}`,
        min: Math.round(d.min),
        max: Math.round(d.max),
        rainChance: d.rainChance === undefined ? undefined : Math.round(d.rainChance),
        ...describeWeather(d.code, true),
      };
    }),
  };
}

/** GET /api/miniapp/weather?region=samarqand → WeatherResponse. Ochiq ma'lumot — initData talab qilinmaydi. */
export function createWeatherHandler(client: WeatherClient, log: (m: string) => void = console.error): RequestHandler {
  return async (req, res) => {
    const region = findRegion(String(req.query.region ?? ""));
    if (!region) {
      res.status(400).json({ error: { message: "Bunday viloyat yo'q." } });
      return;
    }
    try {
      const place: Place = { name: region.city, latitude: region.latitude, longitude: region.longitude, timezone: DEFAULT_TIMEZONE };
      res.set("Cache-Control", "public, max-age=300").json(toWeatherResponse(region, await client.current(place)));
    } catch (err) {
      log(`[weather] ${(err as Error).message}`);
      res.status(502).json({ error: { message: "Ob-havo ma'lumotini olib bo'lmadi, birozdan keyin urinib ko'ring." } });
    }
  };
}
