import type { RequestHandler } from "express";
import { findRegion, REGIONS } from "../../shared/regions.js";
import {
  DEFAULT_TIMEZONE,
  describeWeather,
  FORECAST_DAYS,
  formatDateKey,
  metNoUrl,
  MONTHS,
  openMeteoUrl,
  parseMetNo,
  parseOpenMeteo,
  toWeatherResponse,
  zonedParts,
  type DayForecast,
  type WeatherNow,
} from "../../shared/weather.js";

export { DEFAULT_TIMEZONE, describeWeather, FORECAST_DAYS, type DayForecast, type WeatherNow };

/**
 * Vaqt va ob-havo. Manba: Open-Meteo, u ishlamasa — MET Norway (ikkalasi ham bepul, kalitsiz).
 * Standart shahar — Toshkent; "ob-havo Samarqand" kabi shahar nomi ham qabul qilinadi.
 */

export const TIME_BUTTON = "🕒 Vaqt";
export const WEATHER_BUTTON = "🌤 Ob-havo";

export interface Place {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export const TASHKENT: Place = { name: "Toshkent", latitude: 41.2995, longitude: 69.2401, timezone: DEFAULT_TIMEZONE };

export interface WeatherClient {
  geocode(query: string): Promise<Place | undefined>;
  current(place: Place): Promise<WeatherNow>;
}

type FetchFn = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** MET Norway shartlari: ilovani aniqlaydigan User-Agent majburiy. */
const MET_USER_AGENT = "AllomaAI/1.0 (+https://github.com/Savronbek12/Alloma-AI)";

const normalize = (s: string) => s.toLowerCase().replace(/[ʻʼ‘’`']/g, "").replace(/\s+/g, " ").trim();

/** "Samarqand", "Urganch", "Farg'ona viloyati" → viloyat markazi (tarmoqsiz). */
export function findRegionPlace(query: string): Place | undefined {
  const q = normalize(query).replace(/\s*(viloyati|shahri|vil\.?)$/, "");
  const r = REGIONS.find((x) => [x.name, x.city, x.id].some((n) => normalize(n).replace(/\s*(viloyati|shahri)$/, "") === q));
  return r && { name: r.city, latitude: r.latitude, longitude: r.longitude, timezone: DEFAULT_TIMEZONE };
}

export class OpenMeteoClient implements WeatherClient {
  private readonly cache = new Map<string, { at: number; data: WeatherNow }>();

  constructor(
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
    private readonly cacheMs = 10 * 60_000,
    private readonly log: (m: string) => void = (m) => console.warn(m),
  ) {}

  private async getJson(url: string, headers?: Record<string, string>): Promise<unknown> {
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(12_000), ...(headers ? { headers } : {}) });
    if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
    return res.json();
  }

  async geocode(query: string): Promise<Place | undefined> {
    const local = findRegionPlace(query);
    if (local) return local;
    const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&language=uz&format=json&name=${encodeURIComponent(query)}`;
    const data = (await this.getJson(url)) as {
      results?: { name: string; latitude: number; longitude: number; timezone?: string }[];
    };
    const r = data.results?.[0];
    if (!r) return undefined;
    return { name: r.name, latitude: r.latitude, longitude: r.longitude, timezone: r.timezone ?? DEFAULT_TIMEZONE };
  }

  async current(place: Place): Promise<WeatherNow> {
    const key = `${place.latitude.toFixed(2)},${place.longitude.toFixed(2)}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.cacheMs) return cached.data;

    let result: WeatherNow;
    try {
      result = parseOpenMeteo(await this.getJson(openMeteoUrl(place.latitude, place.longitude, place.timezone)));
    } catch (err) {
      // Open-Meteo umumiy (hosting) IP'larni ko'pincha cheklaydi — MET Norway'ga o'tamiz.
      this.log(`[weather] Open-Meteo: ${(err as Error).message} — MET Norway'ga o'tildi`);
      result = parseMetNo(
        await this.getJson(metNoUrl(place.latitude, place.longitude), { "User-Agent": MET_USER_AGENT }),
        place.timezone,
      );
    }
    this.cache.set(key, { at: Date.now(), data: result });
    return result;
  }
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
  const feels = w.feelsLike === undefined ? "" : ` (sezilishi ${signed(w.feelsLike)}°C)`;
  const lines = [`${d.emoji} <b>${place.name}</b> — ${d.text}`, `🌡 Harorat: <b>${signed(w.temperature)}°C</b>${feels}`];
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
  const rain = day.rainChance !== undefined && day.rainChance >= 20 ? ` (☔ ${round(day.rainChance)}%)` : "";
  return `${d.emoji} <b>${label}</b>, ${formatDateKey(day.date)}: ${signed(day.min)}° … ${signed(day.max)}°C, ${d.text.toLowerCase()}${rain}`;
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
