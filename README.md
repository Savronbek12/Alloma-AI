# Alloma-AI — O'zbek allomalari

Al-Xorazmiydan bugungi kungacha **103 ta** o'zbek allomasi (olim, mutafakkir, adib va san'atkor)
haqida ma'lumot beruvchi veb-sayt. **Node.js + TypeScript** (Express 5) backend va TypeScript frontend.

## Ishga tushirish

```bash
npm install
npm run dev        # http://localhost:3000 (server + client avtomatik qayta yuklanadi)
```

Production:

```bash
npm run build      # dist/ (server) + public/js/app.js (client)
npm start
```

| Buyruq              | Vazifasi                                   |
| ------------------- | ------------------------------------------ |
| `npm run dev`       | Ishlab chiqish rejimi (tsx watch + esbuild) |
| `npm run build`     | Server va client'ni yig'ish                |
| `npm start`         | Yig'ilgan serverni ishga tushirish         |
| `npm run typecheck` | Server va client tiplarini tekshirish      |
| `npm test`          | Vitest testlari                            |

Sozlamalar uchun `.env.example` ni `.env` ga nusxalang (`PORT`, `NODE_ENV`, `CORS_ORIGIN`).

## Loyiha tuzilishi

```
Alloma-AI/
├── shared/                     # Server va client uchun umumiy kod
│   ├── constants.ts            #   davrlar, yo'nalishlar, saralash turlari
│   └── types.ts                #   Alloma, Paginated, Meta ... interfeyslari
├── src/                        # Backend (Node.js + Express)
│   ├── server.ts               #   kirish nuqtasi, graceful shutdown
│   ├── app.ts                  #   Express ilovasi (helmet, cors, static)
│   ├── container.ts            #   bog'liqliklarni yig'ish (DI)
│   ├── config/env.ts           #   .env + Zod validatsiya
│   ├── data/allomalar/         #   ma'lumotlar — har bir davr alohida faylda
│   │   ├── ilk-orta-asr.ts
│   │   ├── temuriylar.ts
│   │   ├── xonliklar.ts
│   │   ├── jadidlar.ts
│   │   ├── zamonaviy.ts
│   │   └── index.ts
│   ├── repositories/           #   ma'lumotlarga kirish (interfeys + in-memory)
│   ├── services/               #   biznes mantiq: qidiruv, filtr, saralash, sahifalash
│   ├── validators/             #   Zod sxemalari (query/params)
│   ├── controllers/            #   HTTP handler'lar
│   ├── routes/                 #   /api marshrutlari
│   ├── middlewares/            #   xatolar, 404, logger
│   ├── types/                  #   server-ichki tiplar
│   └── utils/                  #   slugify, qidiruv normalizatsiyasi, HttpError
├── client/src/                 # Frontend (TypeScript → esbuild → public/js/app.js)
│   ├── main.ts                 #   holat, hodisalar, #/alloma/:slug marshruti
│   ├── api.ts                  #   tiplangan API klienti
│   ├── render.ts               #   HTML shablonlar (XSS'dan himoyalangan)
│   └── utils.ts
├── public/                     # Statik fayllar (index.html, css, favicon)
└── tests/                      # Vitest + Supertest
```

So'rov oqimi: `routes → controllers → validators → services → repositories → data`.
Ma'lumotlar bazasiga (PostgreSQL, MongoDB) o'tish uchun `AllomaRepository` interfeysini
amalga oshiruvchi yangi klass yozib, `container.ts` da almashtirish kifoya — qolgan qatlamlar o'zgarmaydi.

## REST API

| Metod | Yo'l                     | Tavsif                                  |
| ----- | ------------------------ | --------------------------------------- |
| GET   | `/api/health`            | Server holati                           |
| GET   | `/api/meta`              | Jami soni, davrlar va yo'nalishlar statistikasi |
| GET   | `/api/allomalar`         | Ro'yxat (qidiruv, filtr, sahifalash)    |
| GET   | `/api/allomalar/random`  | Tasodifiy alloma                        |
| GET   | `/api/allomalar/:slug`   | Bitta alloma                            |

`/api/allomalar` parametrlari:

| Parametr | Qiymatlar                                                        | Standart    |
| -------- | ---------------------------------------------------------------- | ----------- |
| `q`      | matn — ism, tug'ilgan joy, biografiya va asarlar bo'yicha        | —           |
| `era`    | `ilk-orta-asr`, `temuriylar`, `xonliklar`, `jadidlar`, `zamonaviy` | —         |
| `field`  | `matematika`, `astronomiya`, `tibbiyot`, `adabiyot`, … (`shared/constants.ts`) | — |
| `sort`   | `birthYear`, `-birthYear`, `name`                                | `birthYear` |
| `page`   | 1, 2, …                                                          | `1`         |
| `limit`  | 1–100                                                            | `12`        |

Misol: `GET /api/allomalar?q=gafur&field=adabiyot` — qidiruv apostroflarga sezgir emas
(`G'afur`, `Gʻafur`, `gafur` bir xil topiladi). Noto'g'ri parametrlar `400` bilan batafsil xato qaytaradi.

## Render'ga joylash va keep-alive

Sayt `render.yaml` (Blueprint) orqali Render'ga joylanadi; `main` ga har push avtomatik deploy qiladi.

Render bepul tarifi 15 daqiqa so'rov bo'lmasa servisni uxlatadi. Buning oldini olish uchun server
production'da o'zining ommaviy manziliga (`RENDER_EXTERNAL_URL`, Render avtomatik beradi) har
10 daqiqada `/api/health` so'rovini yuboradi (`src/services/keep-alive.ts`).

| O'zgaruvchi                   | Standart | Tavsif                                      |
| ----------------------------- | -------- | ------------------------------------------- |
| `KEEP_ALIVE`                  | `true`   | `false` — o'chirish                         |
| `KEEP_ALIVE_INTERVAL_MINUTES` | `10`     | 1–14 daqiqa (Render chegarasi 15 daqiqa)    |
| `KEEP_ALIVE_URL`              | —        | Boshqa domen ishlatilsa, qo'lda manzil      |

Eslatma: bepul tarifda oyiga 750 soat beriladi — bitta servis 24/7 ishlashi uchun yetadi
(≈744 soat), lekin shu hisobdagi boshqa bepul servislar bilan bo'lishiladi. Kafolatli 24/7 uchun
pullik "Starter" tarifiga o'tish mumkin.

## Telegram bot

Bot sayt bilan bitta serverda ishlaydi (`src/bot/`). Production'da Telegram xabarlarni
`POST /telegram/webhook` ga yuboradi (maxfiy sarlavha bilan tekshiriladi).

| Imkoniyat              | Tavsif                                                                 |
| ---------------------- | ---------------------------------------------------------------------- |
| Oddiy savol            | Groq AI saytdagi ma'lumotlarga tayanib o'zbekcha javob beradi          |
| Ism yozish             | `Beruniy` — rasmli kartochka (rasm muallifi va litsenziyasi bilan)     |
| `/tasodifiy`           | Tasodifiy alloma                                                       |
| `/qidir <so'z>`        | Qidiruv natijalari tugmalar bilan                                      |
| `/davrlar`             | Davr → allomalar ro'yxati                                              |

Sozlash: `TELEGRAM_BOT_TOKEN` (@BotFather) va `GROQ_API_KEY` (console.groq.com, bepul) ni
Render → Environment bo'limiga qo'shing. Token bo'lmasa sayt botsiz ishlayveradi; Groq kaliti
bo'lmasa buyruqlar ishlaydi, AI javoblari o'chiq bo'ladi. Bepul kvotani himoya qilish uchun
bitta chatdan AI so'rovlari orasida 5 soniya cheklov bor; asosiy model limitga yetsa
`GROQ_FALLBACK_MODEL` ishlatiladi.

### Guruhda boshqa bot bilan suhbat (Bot API 10.0, Bot-to-Bot Communication Mode)

- Guruhda bot odamlarga faqat buyruq, `@AllomaAI_bot`, "Alloma AI" deb murojaat yoki reply bo'lsa javob beradi.
- Boshqa botlarga faqat ular bizning xabarimizga reply qilsa yoki `@AllomaAI_bot` deb yozsa javob beradi;
  o'z xabarlariga hech qachon javob bermaydi. Guruhdagi barcha javoblar reply qilib yuboriladi.
- "Sardor AI'dan X haqida so'ra" — `@sardorbai202bot` bilan boshlanadigan savol yuboriladi (`PARTNER_BOT_USERNAME`).
- Sikldan himoya (`src/bot/bot-guard.ts`, har chat uchun): odam yozmaguncha botlarga ko'pi bilan 4 ta
  ketma-ket javob; bitta botga 3 soniyada 1 ta; 10 daqiqada takrorlangan matnga javob yo'q; botlarga
  xato/limit xabarlari yuborilmaydi; guruhga daqiqasiga ≤20, sekundiga ≤1 xabar; xotirada ≤2000 chat.
- AI'ga guruh tarixi "Ism: matn" / "Ism (bot): matn" ko'rinishida uzatiladi.

## Yangi alloma qo'shish

Tegishli davr faylini oching (masalan, `src/data/allomalar/temuriylar.ts`) va yozuv qo'shing:

```ts
{
  name: "Ism Familiya",
  birthYear: 1400,
  deathYear: 1470,
  yearsApproximate: true,          // ixtiyoriy
  birthPlace: "Samarqand",
  fields: ["astronomiya"],         // shared/constants.ts dagi FIELD_IDS
  bio: "Qisqacha biografiya...",
  works: ["Asar nomi"],
},
```

`id` va `slug` avtomatik yaratiladi. `npm test` ma'lumotlar to'g'riligini tekshiradi
(takroriy slug, noto'g'ri yo'nalish, vafot yili tug'ilgandan oldin va h.k.).

> Eslatma: ma'lumotlar ochiq manbalar asosida qisqa shaklda tayyorlangan; ayrim qadimgi
> allomalarning yillari taxminiy (`yearsApproximate`). Nashrdan oldin mutaxassis tomonidan
> tekshirib chiqish tavsiya etiladi.
