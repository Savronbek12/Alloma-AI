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
}

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
      "&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&wind_speed_unit=ms" +
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
      daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
    }>(url);
    const c = data.current;
    const result: WeatherNow = {
      temperature: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      windSpeed: c.wind_speed_10m,
      code: c.weather_code,
      isDay: c.is_day === 1,
      todayMax: data.daily?.temperature_2m_max?.[0],
      todayMin: data.daily?.temperature_2m_min?.[0],
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
  return lines.join("\n");
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
