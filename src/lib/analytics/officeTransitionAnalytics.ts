import type { Db } from "mongodb";
import type { GameIteration } from "@/lib/db/types/gameState";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { captureServerGameEvent } from "./serverPosthog";

const OFFICE_TYPES = new Set([
  ...Object.values(COUNTRY_CONFIGS).flatMap((country) =>
    country.officeTypes.map((office) => office.key)
  ),
  "house",
  "senate",
  "stateSenate",
  "governor",
  "president",
  "vicePresident",
  "usCabinet",
  "commons",
  "regionalCouncil",
  "primeMinister",
  "ukCabinet",
  "parliamentaryCabinet",
  "bundestag",
  "chancellor",
  "ministerPresident",
  "landtag",
  "deCabinet",
  "centralBankChair",
  "ceo",
  "other",
]);

export async function captureOfficeTransition(input: {
  db: Db;
  officeType: string;
  transitionType: "gained" | "left" | "lost";
  partyId?: string;
  selectionMethod: "election" | "appointment" | "resignation" | "removal" | "succession";
  tenureTurns?: number;
  careerStage?: number;
  nationId?: string;
  turn: number;
  iteration?: GameIteration | null;
  flush?: boolean;
}): Promise<void> {
  await captureServerGameEvent({
    db: input.db,
    event: "office_transition",
    distinctId: "system:office-transitions",
    turn: input.turn,
    iteration: input.iteration,
    flush: input.flush,
    ...(input.nationId ? { nationId: input.nationId } : {}),
    properties: {
      office_type: OFFICE_TYPES.has(input.officeType) ? input.officeType : "other",
      transition_type: input.transitionType,
      party_id:
        input.partyId && /^[A-Za-z0-9_-]{1,32}$/.test(input.partyId) ? input.partyId : "unknown",
      selection_method: input.selectionMethod,
      tenure_turns:
        input.transitionType === "gained"
          ? 0
          : Number.isInteger(input.tenureTurns) && (input.tenureTurns ?? 0) > 0
            ? input.tenureTurns!
            : "unknown",
      career_stage:
        Number.isInteger(input.careerStage) && (input.careerStage ?? -1) >= 0
          ? input.careerStage!
          : 0,
    },
  });
}
