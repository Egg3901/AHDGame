import { z } from "zod";
import { schemas } from "../validate";

export const statePartyAppointmentSchema = z.object({
  position: z.enum(["chair", "viceChair", "treasurer"]),
  characterId: z.union([schemas.objectId, z.null()]).optional(),
});
