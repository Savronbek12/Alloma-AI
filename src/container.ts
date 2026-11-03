import { allomaSeeds } from "./data/allomalar/index.js";
import { allomaImages } from "./data/images.generated.js";
import { InMemoryAllomaRepository } from "./repositories/alloma.repository.js";
import { AllomaService } from "./services/alloma.service.js";

/** Composition root: bog'liqliklar faqat shu yerda yig'iladi. */
export function createContainer() {
  const allomaRepository = new InMemoryAllomaRepository(allomaSeeds, allomaImages);
  const allomaService = new AllomaService(allomaRepository);
  return { allomaRepository, allomaService };
}

export type Container = ReturnType<typeof createContainer>;
