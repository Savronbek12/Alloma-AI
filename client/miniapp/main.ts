import { REGIONS, findRegion, type Region } from "../../shared/regions";
import { SUBJECTS, findSubject, type Subject } from "../../shared/subjects";
import {
  MONTHS,
  metNoUrl,
  openMeteoUrl,
  parseMetNo,
  parseOpenMeteo,
  sunTimes,
  toWeatherResponse,
  zonedParts,
  type WeatherNow,
  type WeatherResponse,
} from "../../shared/weather";

/** Telegram WebApp SDK'ning bizga kerak qismi (https://core.telegram.org/bots/webapps). */
interface TgWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void };
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium"): void;
    notificationOccurred(type: "error" | "success"): void;
  };
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const tg = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
const inTelegram = Boolean(tg?.initData);
const MAX_STORED = 30;
const API = "/api/miniapp/chat";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const home = $("home");
const weather = $("weather");
const chat = $("chat");
const log = $("log");
const intro = $("intro");
const input = $<HTMLTextAreaElement>("input");
const sendBtn = $<HTMLButtonElement>("send");

let current: Subject | undefined;
let history: ChatMessage[] = [];
let busy = false;

// ---------- Saqlash (har fan uchun alohida tarix; xato bo'lsa — faqat xotirada) ----------

const storeKey = (id: string) => `alloma-miniapp:${id}`;

function loadHistory(id: string): ChatMessage[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storeKey(id)) ?? "[]") as ChatMessage[];
    return Array.isArray(parsed) ? parsed.filter((m) => m && typeof m.content === "string") : [];
  } catch {
    return [];
  }
}

function saveHistory(id: string, messages: ChatMessage[]): void {
  try {
    localStorage.setItem(storeKey(id), JSON.stringify(messages.slice(-MAX_STORED)));
  } catch {
    /* saqlash imkonsiz — muammo emas */
  }
}

// ---------- Ko'rsatish ----------

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Oddiy matn + ```kod``` bloklari → xavfsiz HTML. */
function formatAnswer(text: string): string {
  return text
    .split(/```[\w+-]*\n?([\s\S]*?)```/g)
    .map((part, i) => (i % 2 ? `<pre><code>${escapeHtml(part.replace(/\n$/, ""))}</code></pre>` : escapeHtml(part)))
    .join("");
}

function scrollDown(): void {
  log.scrollTop = log.scrollHeight;
}

function addBubble(kind: "user" | "bot" | "error", text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `msg msg--${kind}`;
  if (kind === "bot") el.innerHTML = formatAnswer(text);
  else el.textContent = text;
  log.append(el);
  scrollDown();
  return el;
}

function renderSubjects(): void {
  const list = $("subjects");
  list.replaceChildren(
    ...SUBJECTS.map((s) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "card";
      btn.innerHTML = `<span class="card__emoji" aria-hidden="true">${s.emoji}</span><span class="card__name">${escapeHtml(s.name)}</span>`;
      btn.addEventListener("click", () => {
        tg?.HapticFeedback?.impactOccurred("light");
        location.hash = `#${s.id}`;
      });
      li.append(btn);
      return li;
    }),
  );
}

function openSubject(subject: Subject): void {
  current = subject;
  history = loadHistory(subject.id);
  $("chat-emoji").textContent = subject.emoji;
  $("chat-title").textContent = subject.name;

  const examples = $("examples");
  examples.replaceChildren(
    ...subject.examples.map((q) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "example";
      b.textContent = q;
      b.addEventListener("click", () => void ask(q));
      return b;
    }),
  );

  log.replaceChildren(intro);
  intro.hidden = history.length > 0;
  for (const m of history) addBubble(m.role === "user" ? "user" : "bot", m.content);

  home.hidden = true;
  weather.hidden = true;
  chat.hidden = false;
  tg?.BackButton.show();
  scrollDown();
  if (!inTelegram) addBubble("error", "Bu sahifa Telegram ichida ishlaydi: botdagi «📚 Fanlar» tugmasini bosing.");
}

function showHome(): void {
  current = undefined;
  chat.hidden = true;
  weather.hidden = true;
  home.hidden = false;
  tg?.BackButton.hide();
}

// ---------- Vaqt va ob-havo (viloyat bo'yicha) ----------

type Mode = "obhavo" | "vaqt";
const MODE_TITLE: Record<Mode, { emoji: string; title: string }> = {
  obhavo: { emoji: "🌤", title: "Ob-havo" },
  vaqt: { emoji: "🕒", title: "Vaqt" },
};

/** Bot tugmasidan to'g'ridan-to'g'ri ochilgan bo'lsa — viloyatlar ro'yxatidan «orqaga» yo'q. */
const startedInRegions = /^#(obhavo|vaqt)/.test(location.hash);
const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;
const pad = (n: number) => String(n).padStart(2, "0");
let pickerMode: Mode = "obhavo";
let weatherRequest = 0;
let clockTimer: number | undefined;

function stopClock(): void {
  if (clockTimer !== undefined) clearInterval(clockTimer);
  clockTimer = undefined;
}

function renderRegions(): void {
  $("regions").replaceChildren(
    ...REGIONS.map((r) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "region";
      btn.innerHTML = `<span class="region__name">${escapeHtml(r.name)}</span><span class="region__city">${escapeHtml(r.city)}</span>`;
      btn.addEventListener("click", () => {
        tg?.HapticFeedback?.impactOccurred("light");
        location.hash = `#${pickerMode}/${r.id}`;
      });
      li.append(btn);
      return li;
    }),
  );
}

function showRegionScreen(mode: Mode, title: string): void {
  current = undefined;
  stopClock();
  home.hidden = true;
  chat.hidden = true;
  weather.hidden = false;
  $("w-emoji").textContent = MODE_TITLE[mode].emoji;
  $("w-title").textContent = title;
}

function showRegionPicker(mode: Mode): void {
  pickerMode = mode;
  showRegionScreen(mode, MODE_TITLE[mode].title);
  $("w-pick").hidden = false;
  $("w-result").hidden = true;
  if (startedInRegions) tg?.BackButton.hide();
  else tg?.BackButton.show();
}

function showResult(mode: Mode, region: Region): HTMLElement {
  pickerMode = mode;
  showRegionScreen(mode, region.name);
  tg?.BackButton.show();
  $("w-pick").hidden = true;
  const box = $("w-result");
  box.hidden = false;
  return box;
}

const actions = (mode: Mode, region: Region) => {
  const other: Mode = mode === "obhavo" ? "vaqt" : "obhavo";
  return `<div class="w-actions">
    <a class="pill" href="#${mode}">📍 Boshqa viloyat</a>
    <a class="pill" href="#${other}/${region.id}">${MODE_TITLE[other].emoji} ${MODE_TITLE[other].title}</a>
  </div>`;
};

// --- Vaqt ---

function formatClock(date: Date): string {
  const p = zonedParts(date);
  return `${p.hour}:${p.minute}<span class="clock__sec">:${p.second}</span>`;
}

function hhmm(date: Date): string {
  const p = zonedParts(date);
  return `${p.hour}:${p.minute}`;
}

function showRegionTime(region: Region): void {
  const box = showResult("vaqt", region);
  const now = new Date();
  const p = zonedParts(now);
  const sun = sunTimes(now, region.latitude, region.longitude);
  const dayLength = sun ? Math.round((sun.sunset.getTime() - sun.sunrise.getTime()) / 60_000) : undefined;
  box.innerHTML = `<div class="w-now">
      <p class="w-now__place">${escapeHtml(region.name)} · ${escapeHtml(region.city)}</p>
      <p id="clock" class="clock">${formatClock(now)}</p>
      <p class="w-now__text">${p.weekday}, ${p.day}-${MONTHS[p.month - 1]} ${p.year}-yil</p>
      <p class="w-now__meta"><span>Toshkent vaqti (UTC+5)</span></p>
    </div>
    ${
      sun && dayLength !== undefined
        ? `<ul class="w-days" aria-label="Quyosh">
      <li class="w-day"><span class="w-day__emoji" aria-hidden="true">🌅</span><span class="w-day__label">Quyosh chiqishi</span><span class="w-day__temp">${hhmm(sun.sunrise)}</span></li>
      <li class="w-day"><span class="w-day__emoji" aria-hidden="true">🌇</span><span class="w-day__label">Quyosh botishi</span><span class="w-day__temp">${hhmm(sun.sunset)}</span></li>
      <li class="w-day"><span class="w-day__emoji" aria-hidden="true">☀️</span><span class="w-day__label">Kun uzunligi</span><span class="w-day__temp">${Math.floor(dayLength / 60)} soat ${pad(dayLength % 60)} daq</span></li>
    </ul>`
        : ""
    }
    ${actions("vaqt", region)}`;
  clockTimer = window.setInterval(() => {
    const el = document.getElementById("clock");
    if (el) el.innerHTML = formatClock(new Date());
  }, 1000);
}

// --- Ob-havo ---

/**
 * Ob-havo avval foydalanuvchi qurilmasidan to'g'ridan-to'g'ri olinadi (Open-Meteo, keyin MET Norway),
 * bo'lmasa — serverimiz orqali. Hosting IP'si cheklansa ham ishlayveradi.
 */
async function fetchWeather(region: Region): Promise<WeatherResponse> {
  const direct: (() => Promise<WeatherNow>)[] = [
    async () => parseOpenMeteo(await getJson(openMeteoUrl(region.latitude, region.longitude))),
    async () => parseMetNo(await getJson(metNoUrl(region.latitude, region.longitude))),
  ];
  for (const source of direct) {
    try {
      return toWeatherResponse(region, await source());
    } catch {
      /* keyingi manba */
    }
  }
  const res = await fetch(`/api/miniapp/weather?region=${encodeURIComponent(region.id)}`);
  const body = (await res.json().catch(() => null)) as (WeatherResponse & { error?: { message?: string } }) | null;
  if (!res.ok || !body?.current) throw new Error(body?.error?.message ?? `Xatolik (${res.status}).`);
  return body;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function renderWeather(w: WeatherResponse, region: Region): string {
  const c = w.current;
  const days = w.days
    .map((d) => {
      const rain = d.rainChance !== undefined && d.rainChance >= 20 ? ` · ☔ ${d.rainChance}%` : "";
      return `<li class="w-day">
        <span class="w-day__emoji" aria-hidden="true">${d.emoji}</span>
        <span><span class="w-day__label">${escapeHtml(d.label)}</span>
          <span class="w-day__sub">${escapeHtml(d.date)} · ${escapeHtml(d.text.toLowerCase())}${rain}</span></span>
        <span class="w-day__temp">${signed(d.min)}° … ${signed(d.max)}°</span>
      </li>`;
    })
    .join("");
  const feels = c.feelsLike === undefined ? "" : `<span>Sezilishi ${signed(c.feelsLike)}°</span>`;
  return `<div class="w-now">
      <p class="w-now__place">${escapeHtml(w.region)} · ${escapeHtml(w.city)} · 🕒 ${hhmm(new Date())}</p>
      <div class="w-now__main">
        <span class="w-now__emoji" aria-hidden="true">${c.emoji}</span>
        <span class="w-now__temp">${signed(c.temperature)}°</span>
      </div>
      <p class="w-now__text">${escapeHtml(c.text)}</p>
      <p class="w-now__meta">${feels}<span>💧 ${c.humidity}%</span><span>💨 ${c.windSpeed} m/s</span></p>
    </div>
    <ul class="w-days" aria-label="Prognoz">${days}</ul>
    ${actions("obhavo", region)}`;
}

async function showRegionWeather(region: Region): Promise<void> {
  const box = showResult("obhavo", region);
  box.innerHTML = '<p class="w-status"><span class="typing" aria-label="Yuklanmoqda"><i></i><i></i><i></i></span></p>';

  const id = ++weatherRequest;
  try {
    const data = await fetchWeather(region);
    if (id !== weatherRequest) return;
    box.innerHTML = renderWeather(data, region);
    tg?.HapticFeedback?.notificationOccurred("success");
  } catch (err) {
    if (id !== weatherRequest) return;
    const message = err instanceof TypeError ? "Internet aloqasini tekshiring." : (err as Error).message;
    box.innerHTML = `<p class="w-status">${escapeHtml(message)}</p>${actions("obhavo", region)}`;
    tg?.HapticFeedback?.notificationOccurred("error");
  }
}

function route(): void {
  const hash = location.hash.slice(1);
  const [mode, regionId] = hash.split("/") as [string, string | undefined];
  if (mode === "obhavo" || mode === "vaqt") {
    const region = regionId ? findRegion(regionId) : undefined;
    if (!region) return showRegionPicker(mode);
    if (mode === "vaqt") return showRegionTime(region);
    void showRegionWeather(region);
    return;
  }
  stopClock();
  const subject = findSubject(hash);
  if (subject) openSubject(subject);
  else showHome();
}

// ---------- Savol yuborish ----------

function setBusy(value: boolean): void {
  busy = value;
  sendBtn.disabled = value;
}

async function ask(question: string): Promise<void> {
  const subject = current;
  const text = question.trim();
  if (!subject || !text || busy) return;
  if (!inTelegram) {
    addBubble("error", "Savol berish uchun Mini App'ni Telegram'dagi bot orqali oching.");
    return;
  }

  setBusy(true);
  intro.hidden = true;
  tg?.HapticFeedback?.impactOccurred("light");
  addBubble("user", text);
  const pending: ChatMessage[] = [...history, { role: "user", content: text }];
  const typing = addBubble("bot", "");
  typing.innerHTML = '<span class="typing" aria-label="Yozmoqda"><i></i><i></i><i></i></span>';

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: tg?.initData, subject: subject.id, messages: pending.slice(-17) }),
    });
    const body = (await res.json().catch(() => null)) as { answer?: string; error?: { message?: string } } | null;
    if (!res.ok || !body?.answer) {
      throw new Error(
        res.status === 404 ? "Bot hozircha ulanmagan." : (body?.error?.message ?? `Xatolik (${res.status}).`),
      );
    }
    // Foydalanuvchi boshqa fanga o'tib ketgan bo'lsa ham javob o'z faniga saqlanadi.
    const updated: ChatMessage[] = [...pending, { role: "assistant", content: body.answer }];
    saveHistory(subject.id, updated);
    if (current?.id === subject.id) {
      history = updated;
      typing.innerHTML = formatAnswer(body.answer);
      scrollDown();
    }
    tg?.HapticFeedback?.notificationOccurred("success");
  } catch (err) {
    typing.remove();
    const message = err instanceof TypeError ? "Internet aloqasini tekshiring." : (err as Error).message;
    if (current?.id === subject.id) {
      addBubble("error", message);
      // Yuborilmagan savolni qayta tahrirlash uchun qaytaramiz.
      if (!input.value) input.value = text;
    }
    tg?.HapticFeedback?.notificationOccurred("error");
  } finally {
    setBusy(false);
  }
}

function autosize(): void {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
}

$<HTMLFormElement>("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value;
  if (!text.trim() || busy) return;
  input.value = "";
  autosize();
  void ask(text);
});

input.addEventListener("input", autosize);
input.addEventListener("keydown", (e) => {
  // Kompyuterda Enter — yuborish, Shift+Enter — yangi qator.
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer: fine)").matches) {
    e.preventDefault();
    $<HTMLFormElement>("composer").requestSubmit();
  }
});

$("reset").addEventListener("click", () => {
  if (!current || busy) return;
  history = [];
  saveHistory(current.id, []);
  log.replaceChildren(intro);
  intro.hidden = false;
});

const goHome = () => {
  location.hash = "";
};
/** Orqaga: prognozdan — viloyatlarga, qolganidan — bosh sahifaga. */
const goBack = () => {
  const m = location.hash.match(/^#(obhavo|vaqt)\//);
  location.hash = m ? `#${m[1]}` : "";
};
$("back").addEventListener("click", goHome);
$("w-back").addEventListener("click", goBack);
tg?.BackButton.onClick(goBack);
window.addEventListener("hashchange", route);

if (inTelegram) document.documentElement.classList.add("tg");
renderSubjects();
renderRegions();
route();
tg?.ready();
tg?.expand();
