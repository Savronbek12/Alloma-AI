import { createTelegramRuntime, type TelegramRuntime } from "./bot/index.js";
import { OpenMeteoClient, type WeatherClient } from "./bot/weather.js";
import { allomaSeeds } from "./data/allomalar/index.js";
import { allomaImages } from "./data/images.generated.js";
import { InMemoryAllomaRepository } from "./repositories/alloma.repository.js";
import { AllomaService } from "./services/alloma.service.js";

export interface Container {
  allomaRepository: InMemoryAllomaRepository;
  allomaService: AllomaService;
  /** Ob-havo manbasi (bot va Mini App uchun umumiy, keshli). */
  weather: WeatherClient;
  /** Telegram bot (TELEGRAM_BOT_TOKEN berilmagan bo'lsa — undefined). */
  telegram?: TelegramRuntime | undefined;
}

/** Composition root: bog'liqliklar faqat shu yerda yig'iladi. */
export function createContainer(options: { withBot?: boolean } = {}): Container {
  const allomaRepository = new InMemoryAllomaRepository(allomaSeeds, allomaImages);
  const allomaService = new AllomaService(allomaRepository);
  const weather = new OpenMeteoClient();
  const telegram = options.withBot ? createTelegramRuntime(allomaService, weather) : undefined;
  return { allomaRepository, allomaService, weather, telegram };
}
