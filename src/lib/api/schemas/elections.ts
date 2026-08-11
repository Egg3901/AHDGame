import { z } from "zod";
import { schemas } from "../validate";

const POSITION_ENUM = z.enum(["chair", "viceChair", "treasurer"]);

export const nationalPartyVoteSchema = z.object({
  candidateId: schemas.objectId,
  position: POSITION_ENUM,
});

export const nationalPartyEnterSchema = z.object({
  position: POSITION_ENUM,
  withdraw: z.boolean().optional(),
});

export const statePartyVoteSchema = z.object({
  candidateId: schemas.objectId,
  position: POSITION_ENUM,
});

export const statePartyEnterSchema = z.object({
  position: POSITION_ENUM,
  withdraw: z.boolean().optional(),
});
