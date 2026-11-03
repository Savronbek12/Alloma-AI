import type { EraId } from "../../../shared/constants.js";
import type { AllomaInput, AllomaSeed } from "../../types/alloma.js";
import { ilkOrtaAsr } from "./ilk-orta-asr.js";
import { jadidlar } from "./jadidlar.js";
import { temuriylar } from "./temuriylar.js";
import { xonliklar } from "./xonliklar.js";
import { zamonaviy } from "./zamonaviy.js";

const withEra = (era: EraId, seeds: readonly AllomaSeed[]): AllomaInput[] =>
  seeds.map((seed) => ({ ...seed, era }));

/** Barcha allomalar — har bir davr o'z faylida saqlanadi. */
export const allomaSeeds: readonly AllomaInput[] = [
  ...withEra("ilk-orta-asr", ilkOrtaAsr),
  ...withEra("temuriylar", temuriylar),
  ...withEra("xonliklar", xonliklar),
  ...withEra("jadidlar", jadidlar),
  ...withEra("zamonaviy", zamonaviy),
];
