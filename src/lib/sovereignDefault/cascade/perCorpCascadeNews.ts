/**
 * Per-corp cascade news — one post per insolvent corp surfaced during a
 * sovereign default cascade. Phase 7 emitted the aggregate summary; Phase 9a
 * adds the per-corp surfacing the design specified.
 */

import type { ObjectId } from "mongodb";
import { createSystemNewsPost } from "@/lib/news";

export interface PerCorpCascadeNewsContext {
  countryCode: string;
  level: number;
  corpId: ObjectId;
  corpName: string;
  corpType: string;
  corpCountryId: string;
}

export async function emitPerCorpCascadeNews(ctx: PerCorpCascadeNewsContext): Promise<void> {
  const content =
    `Cascade Casualty — ${ctx.corpName} (${ctx.corpType}, ${ctx.corpCountryId}) is ` +
    `insolvent following ${ctx.countryCode}'s sovereign default (cascade level ${ctx.level}).`;
  await createSystemNewsPost(content, "sovereign");
}
