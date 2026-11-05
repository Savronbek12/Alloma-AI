import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { REGIONS } from "../shared/regions.js";
import { AllomaBot, BOT_COMMANDS } from "../src/bot/alloma-bot.js";
import type { BotApi, TgUpdate } from "../src/bot/telegram-api.js";
import {
  createWeatherHandler,
  formatTime,
  MINIAPP_WEATHER_PATH,
  isTimeQuestion,
  parseWeatherRequest,
  TIME_BUTTON,
  WEATHER_BUTTON,
  type Place,
  type WeatherClient,
  type WeatherNow,
} from "../src/bot/weather.js";
import { createContainer } from "../src/container.js";

const service = createContainer().allomaService;

class FakeApi implements BotApi {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ method, params });
    return true as T;
  }
  lastText(): string {
    return String(this.calls.filter((c) => c.method === "sendMessage").at(-1)?.params.text ?? "");
  }
}

class FakeWeather implements WeatherClient {
  places: string[] = [];
  async geocode(query: string): Promise<Place | undefined> {
    if (query.toLowerCase() === "samarqand") return { name: "Samarqand", latitude: 39.65, longitude: 66.96, timezone: "Asia/Samarkand" };
    return undefined;
  }
  async current(place: Place): Promise<WeatherNow> {
    this.places.push(place.name);
    return { temperature: 12.4, feelsLike: 10.2, humidity: 55, windSpeed: 3.2, code: 0, isDay: true, todayMin: 5, todayMax: 16,
      days: [
        { date: "2026-11-05", code: 0, min: 5, max: 16, rainChance: 0 },
        { date: "2026-11-06", code: 61, min: 7.6, max: 14.8, rainChance: 70 },
        { date: "2026-11-07", code: 3, min: 4, max: 11, rainChance: 10 },
      ],
    };
  }
}

// 2026-11-05 09:05 UTC = 14:05 Toshkent (UTC+5), payshanba.
const NOW = Date.UTC(2026, 10, 5, 9, 5);
const text = (t: string): TgUpdate => ({ update_id: 1, message: { message_id: 1, chat: { id: 1, type: "private" }, text: t } });

function setup() {
  const api = new FakeApi();
  const weather = new FakeWeather();
  const bot = new AllomaBot({ api, service, weather, log: () => {}, now: () => NOW });
  return { api, weather, bot };
}

describe("vaqt va ob-havo", () => {
  it("formatTime — Toshkent vaqti va o'zbekcha sana", () => {
    const out = formatTime(new Date(NOW));
    expect(out).toContain("14:05");
    expect(out).toContain("Payshanba, 5-noyabr 2026-yil");
  });

  it("vaqt savollarini taniydi", () => {
    expect(isTimeQuestion("Soat necha?")).toBe(true);
    expect(isTimeQuestion("hozir vaqt qancha")).toBe(true);
    expect(isTimeQuestion("Vaqt nisbiyligi nima?")).toBe(false);
  });

  it("ob-havo so'rovidan shaharni ajratadi", () => {
    expect(parseWeatherRequest("ob-havo")).toBe("");
    expect(parseWeatherRequest("Ob havo qanday?")).toBe("");
    expect(parseWeatherRequest("Samarqandda ob-havo qanday?")).toBe("Samarqand");
    expect(parseWeatherRequest("ob-havo Buxoro")).toBe("Buxoro");
    expect(parseWeatherRequest("Fotosintez nima?")).toBeUndefined();
  });

  it("menyuda /vaqt va /obhavo bor", () => {
    const names = BOT_COMMANDS.map((c) => c.command);
    expect(names).toContain("vaqt");
    expect(names).toContain("obhavo");
  });

  it("«🕒 Vaqt» tugmasi vaqtni aytadi", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate(text(TIME_BUTTON));
    expect(api.lastText()).toContain("14:05");
  });

  it("«🌤 Ob-havo» tugmasi Toshkent ob-havosini aytadi", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate(text(WEATHER_BUTTON));
    expect(api.lastText()).toContain("Toshkent");
    expect(api.lastText()).toContain("+12°C");
    expect(api.lastText()).toContain("<b>Ertaga</b>, 6-noyabr: +8° … +15°C, yomg'ir (☔ 70%)");
    expect(api.lastText()).toContain("<b>Indinga</b>, 7-noyabr: +4° … +11°C, bulutli");
    expect(api.lastText()).not.toContain("☔ 10%");
  });

  it("/obhavo Samarqand — boshqa shahar", async () => {
    const { api, weather, bot } = setup();
    await bot.handleUpdate(text("/obhavo Samarqand"));
    expect(weather.places).toEqual(["Samarqand"]);
    expect(api.lastText()).toContain("Samarqand");
  });

  it("noma'lum shahar — tushunarli javob", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate(text("/obhavo Qwertyabad"));
    expect(api.lastText()).toContain("topilmadi");
  });
});

describe("ob-havo Mini App", () => {
  const APP = "https://alloma-ai.onrender.com/app/";

  it("«🌤 Ob-havo» pastki tugmasi Mini App'ning viloyat tanlash ekranini ochadi", async () => {
    const api = new FakeApi();
    const bot = new AllomaBot({ api, service, weather: new FakeWeather(), miniAppUrl: APP, log: () => {} });
    await bot.handleUpdate(text("/start"));
    const msg = api.calls.find((c) => c.method === "sendMessage");
    const keyboard = (msg?.params.reply_markup as { keyboard: { text: string; web_app?: { url: string } }[][] }).keyboard;
    expect(keyboard[1]?.[1]).toEqual({ text: WEATHER_BUTTON, web_app: { url: `${APP}#obhavo` } });
  });

  it("/obhavo javobida «📍 Viloyatni tanlash» tugmasi bor", async () => {
    const api = new FakeApi();
    const bot = new AllomaBot({ api, service, weather: new FakeWeather(), miniAppUrl: APP, log: () => {} });
    await bot.handleUpdate(text("/obhavo"));
    const msg = api.calls.at(-1);
    const buttons = (msg?.params.reply_markup as { inline_keyboard: { web_app?: { url: string } }[][] }).inline_keyboard;
    expect(buttons[0]?.[0]?.web_app?.url).toBe(`${APP}#obhavo`);
  });

  it("14 ta hudud, id'lar takrorlanmaydi", () => {
    expect(REGIONS).toHaveLength(14);
    expect(new Set(REGIONS.map((r) => r.id)).size).toBe(14);
  });

  it("GET /api/miniapp/weather — viloyat bo'yicha prognoz", async () => {
    const app = express().get(MINIAPP_WEATHER_PATH, createWeatherHandler(new FakeWeather(), () => {}));
    const res = await request(app).get(`${MINIAPP_WEATHER_PATH}?region=samarqand`);
    expect(res.status).toBe(200);
    expect(res.body.region).toBe("Samarqand");
    expect(res.body.current.temperature).toBe(12);
    expect(res.body.days.map((d: { label: string }) => d.label)).toEqual(["Bugun", "Ertaga", "Indinga"]);
    expect(res.body.days[1]).toMatchObject({ date: "6-noyabr", min: 8, max: 15, rainChance: 70, text: "Yomg'ir" });
  });

  it("noma'lum viloyat — 400", async () => {
    const app = express().get(MINIAPP_WEATHER_PATH, createWeatherHandler(new FakeWeather(), () => {}));
    const res = await request(app).get(`${MINIAPP_WEATHER_PATH}?region=yoq`);
    expect(res.status).toBe(400);
  });
});
