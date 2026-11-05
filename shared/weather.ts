/**
 * Ob-havo va vaqt uchun umumiy kod (server va Mini App).
 * Manbalar: Open-Meteo (asosiy) va MET Norway (zaxira) — ikkalasi ham bepul, kalitsiz, CORS ochiq.
 */

export const DEFAULT_TIMEZONE = "Asia/Tashkent";
export const FORECAST_DAYS = 3;

export interface WeatherNow {
  temperature: number;
  /** Sezilishi (MET Norway bermaydi — undefined). */
  feelsLike?: number | undefined;
  humidity: number;
  windSpeed: number;
  /** WMO ob-havo kodi. */
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

export const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
export const MONTHS = [
  "yanvar", "fevral", "mart", "aprel", "may", "iyun",
  "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr",
];

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

/** Berilgan vaqt mintaqasidagi sana/vaqt qismlari. */
export function zonedParts(date: Date, timeZone: string = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  return {
    year,
    month,
    day,
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
    weekday: WEEKDAYS[weekdayIndex] ?? "",
    /** "2026-11-05" */
    dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

/** "2026-11-06" → "6-noyabr" */
export function formatDateKey(dateKey: string): string {
  const [, month = "1", day = "1"] = dateKey.split("-");
  return `${Number(day)}-${MONTHS[Number(month) - 1]}`;
}

// ---------- Open-Meteo ----------

export function openMeteoUrl(latitude: number, longitude: number, timeZone: string = DEFAULT_TIMEZONE): string {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
    `&forecast_days=${FORECAST_DAYS}&wind_speed_unit=ms&timezone=${encodeURIComponent(timeZone)}`
  );
}

interface OpenMeteoJson {
  current?: {
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
}

export function parseOpenMeteo(json: unknown): WeatherNow {
  const data = json as OpenMeteoJson;
  const c = data.current;
  if (!c || typeof c.temperature_2m !== "number") throw new Error("Open-Meteo: javob noto'g'ri");
  const d = data.daily;
  const days: DayForecast[] = (d?.time ?? []).flatMap((date, i) => {
    const code = d?.weather_code?.[i];
    const min = d?.temperature_2m_min?.[i];
    const max = d?.temperature_2m_max?.[i];
    if (code == null || min == null || max == null) return [];
    return [{ date, code, min, max, rainChance: d?.precipitation_probability_max?.[i] ?? undefined }];
  });
  return {
    temperature: c.temperature_2m,
    feelsLike: c.apparent_temperature,
    humidity: c.relative_humidity_2m,
    windSpeed: c.wind_speed_10m,
    code: c.weather_code,
    isDay: c.is_day === 1,
    todayMin: days[0]?.min,
    todayMax: days[0]?.max,
    days,
  };
}

// ---------- MET Norway (zaxira) ----------

export function metNoUrl(latitude: number, longitude: number): string {
  return `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${latitude.toFixed(4)}&lon=${longitude.toFixed(4)}`;
}

/** MET Norway belgisi ("lightrainshowers_day") → WMO kodi. */
export function metSymbolToWmo(symbol: string): { code: number; isDay: boolean } {
  const isDay = !symbol.endsWith("_night");
  const s = symbol.replace(/_(day|night|polartwilight)$/, "");
  let code = 3;
  if (s === "clearsky") code = 0;
  else if (s === "fair") code = 1;
  else if (s === "partlycloudy") code = 2;
  else if (s === "cloudy") code = 3;
  else if (s === "fog") code = 45;
  else if (s.includes("thunder")) code = 95;
  else if (s.includes("sleet")) code = 67;
  else if (s.includes("snow")) code = s.includes("showers") ? 85 : 71;
  else if (s.includes("rain")) code = s.includes("showers") ? 80 : s.startsWith("light") ? 51 : s.startsWith("heavy") ? 65 : 61;
  return { code, isDay };
}

interface MetNoJson {
  properties?: {
    timeseries?: {
      time: string;
      data: {
        instant: { details: { air_temperature?: number; relative_humidity?: number; wind_speed?: number } };
        next_1_hours?: { summary?: { symbol_code?: string } };
        next_6_hours?: { summary?: { symbol_code?: string } };
      };
    }[];
  };
}

export function parseMetNo(json: unknown, timeZone: string = DEFAULT_TIMEZONE): WeatherNow {
  const series = (json as MetNoJson).properties?.timeseries ?? [];
  const first = series[0];
  const inst = first?.data.instant.details;
  if (!first || inst?.air_temperature === undefined) throw new Error("MET Norway: javob noto'g'ri");
  const symbolOf = (e: (typeof series)[number]) =>
    e.data.next_1_hours?.summary?.symbol_code ?? e.data.next_6_hours?.summary?.symbol_code;
  const now = metSymbolToWmo(symbolOf(first) ?? "cloudy");

  // Soatlik qatorni mahalliy sana bo'yicha kunlarga ajratamiz.
  const byDay = new Map<string, { min: number; max: number; symbol?: string | undefined; noonSymbol?: string | undefined }>();
  for (const e of series) {
    const t = e.data.instant.details.air_temperature;
    if (t === undefined) continue;
    const p = zonedParts(new Date(e.time), timeZone);
    const day = byDay.get(p.dateKey) ?? { min: t, max: t };
    day.min = Math.min(day.min, t);
    day.max = Math.max(day.max, t);
    const sym = e.data.next_6_hours?.summary?.symbol_code ?? symbolOf(e);
    day.symbol ??= sym;
    if (Number(p.hour) >= 9 && Number(p.hour) <= 13 && sym) day.noonSymbol ??= sym;
    byDay.set(p.dateKey, day);
    if (byDay.size > FORECAST_DAYS) break;
  }
  const days: DayForecast[] = [...byDay.entries()].slice(0, FORECAST_DAYS).map(([date, d]) => ({
    date,
    code: metSymbolToWmo(d.noonSymbol ?? d.symbol ?? "cloudy").code,
    min: d.min,
    max: d.max,
  }));
  return {
    temperature: inst.air_temperature,
    humidity: inst.relative_humidity ?? 0,
    windSpeed: inst.wind_speed ?? 0,
    code: now.code,
    isDay: now.isDay,
    todayMin: days[0]?.min,
    todayMax: days[0]?.max,
    days,
  };
}

// ---------- Mini App javobi ----------

/** Mini App'dagi ob-havo ekrani uchun tayyor ma'lumot. */
export interface WeatherResponse {
  region: string;
  city: string;
  current: { temperature: number; feelsLike?: number | undefined; humidity: number; windSpeed: number; emoji: string; text: string };
  days: { label: string; date: string; min: number; max: number; rainChance?: number | undefined; emoji: string; text: string }[];
}

export function toWeatherResponse(region: { name: string; city: string }, w: WeatherNow): WeatherResponse {
  const labels = ["Bugun", "Ertaga", "Indinga"];
  return {
    region: region.name,
    city: region.city,
    current: {
      temperature: Math.round(w.temperature),
      feelsLike: w.feelsLike === undefined ? undefined : Math.round(w.feelsLike),
      humidity: Math.round(w.humidity),
      windSpeed: Math.round(w.windSpeed),
      ...describeWeather(w.code, w.isDay),
    },
    days: (w.days ?? []).slice(0, FORECAST_DAYS).map((d, i) => ({
      label: labels[i] ?? "",
      date: formatDateKey(d.date),
      min: Math.round(d.min),
      max: Math.round(d.max),
      rainChance: d.rainChance === undefined ? undefined : Math.round(d.rainChance),
      ...describeWeather(d.code, true),
    })),
  };
}

// ---------- Quyosh chiqishi / botishi (tarmoqsiz, astronomik hisob) ----------

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
const OBLIQUITY = RAD * 23.4397;

/**
 * Berilgan kun uchun quyosh chiqishi va botishi (SunCalc usuli, ±1 daqiqa).
 * Qutb kuni/tunida — undefined.
 */
export function sunTimes(date: Date, latitude: number, longitude: number): { sunrise: Date; sunset: Date } | undefined {
  const lw = RAD * -longitude;
  const phi = RAD * latitude;
  const d = date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const approxTransit = (ht: number) => 0.0009 + (ht + lw) / (2 * Math.PI) + n;
  const ds = approxTransit(0);
  const M = RAD * (357.5291 + 0.98560028 * ds);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
  const transitJ = (a: number) => J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const jNoon = transitJ(ds);
  const cosW = (Math.sin(RAD * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosW < -1 || cosW > 1) return undefined;
  const jSet = transitJ(approxTransit(Math.acos(cosW)));
  const jRise = jNoon - (jSet - jNoon);
  const fromJulian = (j: number) => new Date((j + 0.5 - J1970) * DAY_MS);
  return { sunrise: fromJulian(jRise), sunset: fromJulian(jSet) };
}
