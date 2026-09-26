import { createHash } from "node:crypto";

/**
 * Creation-time missing-context inference for Discord support tickets.
 *
 * Deterministic and dependency-free on purpose: it runs inside the ticket
 * filing request, where the triage worker and the Jev classifier are not
 * available (and may be disabled or delayed — ticket #1339 waited ~15h for
 * its follow-up questions). The ops dashboard later refines the same decision
 * with the model; the key format below MUST stay byte-identical to the
 * dashboard's `contextRequestKey` so both sides dedupe on one idempotent
 * player-update ledger key.
 */

export type TicketContextNeed = "discord" | "corporation" | "page";

/** Player-facing wording per missing detail. Plain language, no internals. */
export const CONTEXT_QUESTIONS: Record<TicketContextNeed, string> = {
  discord:
    "Link your Discord account to the game, then reply here so we can match this report to your game data.",
  corporation:
    "Please reply with the corporation's in-game link, or its exact name and ticker, so we can check the right company.",
  page: "Please reply with the affected page's in-game link, or the exact menu path where it appears.",
};

const CORP_WORDS =
  /\b(?:corp(?:oration)?|company|ceo|shareholder|shareholders|shares?|subsidiary|buyout|charter|stock|ticker)\b/i;
const PAGE_WORDS =
  /\b(?:page|screen|tab|button|market|profile|menu|web\s+browser|mobile|ui|blank|error)\b|\b(?:doesn['’]t|does\s+not|not|can['’]t|cannot|won['’]t|fails?)\s+(?:show|load|work|open|match|display)/i;
const URL_RE = /https?:\/\/[^\s<>()]+/gi;

function isUsefulPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return false;
    if (/discord(?:app)?\.com|ops\.lakesidegames\.net/i.test(url.hostname)) return false;
    return !/\/character\//i.test(url.pathname) && !/\/corporation\//i.test(url.pathname);
  } catch {
    return false;
  }
}

export interface CreationContextInput {
  title: string;
  description: string;
  /** True when the opener's Discord id resolved to a linked game account. */
  hasGameIdentity: boolean;
  /** Reporter corporation URL resolved at filing, if any. */
  corporationUrl?: string | null;
}

/** Which follow-up details are missing at filing time. Deterministic. */
export function inferCreationContextNeeds(input: CreationContextInput): TicketContextNeed[] {
  const text = `${input.title || ""}\n${input.description || ""}`.slice(0, 12_000);
  const needed: TicketContextNeed[] = [];
  if (!input.hasGameIdentity) needed.push("discord");
  if (CORP_WORDS.test(text) && !input.corporationUrl) needed.push("corporation");
  if (PAGE_WORDS.test(text)) {
    const urls = text.match(URL_RE) || [];
    if (!urls.some(isUsefulPageUrl)) needed.push("page");
  }
  return needed;
}

/**
 * Idempotent ledger key for a set of needs. MUST match the dashboard's
 * `contextRequestKey` (`context:` + sha1 of comma-joined sorted needs, 16 hex).
 */
export function creationContextKey(needed: TicketContextNeed[]): string | null {
  const values = [...new Set(needed)].sort();
  if (!values.length) return null;
  return `context:${createHash("sha1").update(values.join(",")).digest("hex").slice(0, 16)}`;
}

export interface CreationContextRequest {
  version: 1;
  needed: TicketContextNeed[];
  key: string | null;
  reason: string;
  generatedAt: string;
  generatedBy: "creation-deterministic";
}

export function buildCreationContextRequest(
  input: CreationContextInput,
  now = new Date()
): CreationContextRequest {
  const needed = inferCreationContextNeeds(input);
  return {
    version: 1,
    needed,
    key: creationContextKey(needed),
    reason:
      "We need one or more links or account details to match this report to the right game records.",
    generatedAt: now.toISOString(),
    generatedBy: "creation-deterministic",
  };
}
