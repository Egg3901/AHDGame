import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { NewsPost, NewsCategory } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

const SYSTEM_AUTHOR_NAME = "National Wire Service";

/**
 * Insert a system-generated news post visible to all players.
 */
export async function createSystemNewsPost(
  content: string,
  category: NewsCategory,
  options: { title?: string } = {}
): Promise<void> {
  const db = await getDb();
  const now = new Date();

  const post: Omit<NewsPost, "_id"> = {
    authorId: new ObjectId("000000000000000000000000"), // Sentinel for system
    authorName: SYSTEM_AUTHOR_NAME,
    isSystem: true,
    category,
    ...(options.title ? { title: options.title } : {}),
    content,
    reactions: { agree: 0, disagree: 0 },
    replyCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection("newsPosts").insertOne(post);
}

// ─── Election result aggregation ──────────────────────────────────────────────

interface ElectionOutcome {
  electionType: string;
  state: string;
  countryId: string;
  winnerName: string;
  winnerParty: string;
  isPlayer: boolean;
}

/**
 * Generate an aggregated news post for a batch of resolved elections.
 * Groups by type (house, senate, governor, commons) and outputs top-line
 * numbers rather than one post per race.
 */
export async function generateElectionNews(outcomes: ElectionOutcome[]): Promise<void> {
  if (outcomes.length === 0) return;

  const db = await getDb();

  // Batch-resolve party names (sequentialId → name) — winnerParty is stored as sequentialId string
  const partyLookups: { countryId: string; sequentialId: number }[] = [];
  const seenKeys = new Set<string>();
  for (const o of outcomes) {
    const seqId = parseInt(o.winnerParty, 10);
    if (!isNaN(seqId)) {
      const key = `${o.countryId}:${seqId}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        partyLookups.push({ countryId: o.countryId, sequentialId: seqId });
      }
    }
  }

  const partyNameMap = new Map<string, string>();
  if (partyLookups.length > 0) {
    const parties = await db
      .collection<{ sequentialId: number; countryId: string; name: string }>("politicalParties")
      .find({
        $or: partyLookups.map((p) => ({ countryId: p.countryId, sequentialId: p.sequentialId })),
      })
      .project({ name: 1, countryId: 1, sequentialId: 1 })
      .toArray();
    for (const p of parties) {
      partyNameMap.set(`${p.countryId}:${p.sequentialId}`, p.name);
    }
  }

  const getPartyName = (countryId: string, partyId: string): string => {
    const seqId = parseInt(partyId, 10);
    if (!isNaN(seqId)) {
      const resolved = partyNameMap.get(`${countryId}:${seqId}`);
      if (resolved) return resolved;
    }
    return capitalize(partyId);
  };

  // Group by election type
  const byType = new Map<string, ElectionOutcome[]>();
  for (const o of outcomes) {
    const existing = byType.get(o.electionType) ?? [];
    existing.push(o);
    byType.set(o.electionType, existing);
  }

  const lines: string[] = [];

  for (const [type, results] of byType) {
    const label = ELECTION_TYPE_LABEL[type] ?? type;

    if (results.length === 1) {
      // Single race — name the winner
      const r = results[0];
      const party = r.winnerParty ? ` (${getPartyName(r.countryId, r.winnerParty)})` : "";
      const playerTag = r.isPlayer ? " [Player]" : "";
      lines.push(`${label} — ${r.state}: ${r.winnerName}${party} wins${playerTag}`);
    } else {
      // Multiple races — aggregate by party
      const partyWins = new Map<string, { count: number; countryId: string }>();
      const playerWinners: string[] = [];

      for (const r of results) {
        const partyKey = r.winnerParty || "independent";
        const entry = partyWins.get(partyKey);
        if (entry) {
          entry.count++;
        } else {
          partyWins.set(partyKey, { count: 1, countryId: r.countryId });
        }
        if (r.isPlayer) {
          playerWinners.push(`${r.winnerName} (${r.state})`);
        }
      }

      // Sort parties by win count descending
      const sorted = [...partyWins.entries()].sort((a, b) => b[1].count - a[1].count);
      const summary = sorted
        .map(([partyId, { count, countryId }]) => `${getPartyName(countryId, partyId)} ${count}`)
        .join(", ");

      lines.push(`${label} Results (${results.length} races): ${summary}`);

      // Highlight player winners
      if (playerWinners.length > 0) {
        const playerList =
          playerWinners.length <= 3
            ? playerWinners.join(", ")
            : `${playerWinners.slice(0, 3).join(", ")} and ${playerWinners.length - 3} more`;
        lines.push(`  Player winners: ${playerList}`);
      }
    }
  }

  const content = lines.join("\n");
  await createSystemNewsPost(content, "election");
}

// ─── Bill news ────────────────────────────────────────────────────────────────

export async function generateBillSignedNews(
  billTitle: string,
  sponsorName: string,
  scope: "federal" | "state",
  state?: string
): Promise<void> {
  const location = scope === "federal" ? "federal" : `${state ?? "state"} state`;
  const content = `New Law: "${billTitle}" has been signed into law at the ${location} level. Sponsored by ${sponsorName}.`;
  await createSystemNewsPost(content, "legislation");
}

export async function generateBillVetoedNews(
  billTitle: string,
  scope: "federal" | "state",
  state?: string,
  countryId?: CountryId
): Promise<void> {
  const config = countryId ? COUNTRY_CONFIGS[countryId] : undefined;
  const executive =
    scope === "federal" ? "the President" : `the Governor of ${state ?? "the state"}`;
  const overrideBody =
    scope === "federal"
      ? (config?.legislature.name ?? "Congress")
      : (config?.subNationalChamber?.name ?? "The State Senate");
  const content = `Veto: "${billTitle}" has been vetoed by ${executive}. ${overrideBody} may attempt an override.`;
  await createSystemNewsPost(content, "legislation");
}

// ─── Address news ─────────────────────────────────────────────────────────────

/**
 * Generate a news post announcing a delivered address (State of the State for
 * governors, or National Address for country leaders).
 */
export async function generateAddressNews(input: {
  scope: "state" | "national";
  addressName: string;
  title: string;
  deliveredByName: string;
  countryId?: CountryId;
  state?: string;
  emphasizedCategories?: string[];
  /** Optional LARP-written speech body. When present, appended after the
   *  summary line so the in-app news post shows the full address. The
   *  Discord-side preview truncates `content` to 200 chars so it lands on
   *  the summary; clicking through opens the full body. */
  body?: string;
}): Promise<void> {
  const { scope, addressName, title, deliveredByName, state, emphasizedCategories, body } = input;
  const where =
    scope === "national"
      ? input.countryId
        ? `the ${COUNTRY_CONFIGS[input.countryId]?.name ?? "nation"}`
        : "the nation"
      : `${state ?? "the state"}`;
  const emphasis =
    emphasizedCategories && emphasizedCategories.length > 0
      ? ` Emphasizing ${emphasizedCategories.map(capitalize).join(" and ")}.`
      : "";
  const summary = `${deliveredByName} delivered the ${addressName} to ${where}.${emphasis}`;
  const trimmedBody = body?.trim();
  const content = trimmedBody ? `${summary}\n\n${trimmedBody}` : summary;
  const newsTitle = `${addressName}: ${title}`;
  await createSystemNewsPost(content, "executive", { title: newsTitle });
}

// ─── Executive Order / Order in Council news ─────────────────────────────────

/**
 * Generate a news post announcing an issued executive order (US Governor /
 * President) or Order in Council (parliamentary head of government).
 * Posts in the "executive" category so the Discord bot's news filter picks
 * it up alongside Address and other executive-branch activity.
 */
export async function generateOrderNews(input: {
  scope: "state" | "national";
  orderName: string;
  legislationTypeName: string;
  policyOptionNameBefore: string | null;
  policyOptionNameAfter: string | null;
  issuedByName: string;
  countryId?: CountryId;
  state?: string;
}): Promise<void> {
  const {
    scope,
    orderName,
    legislationTypeName,
    policyOptionNameBefore,
    policyOptionNameAfter,
    issuedByName,
    state,
  } = input;
  const where =
    scope === "national"
      ? input.countryId
        ? `the ${COUNTRY_CONFIGS[input.countryId]?.name ?? "nation"}`
        : "the nation"
      : `${state ?? "the state"}`;
  const transition =
    policyOptionNameBefore && policyOptionNameAfter
      ? ` Shifting from ${policyOptionNameBefore} to ${policyOptionNameAfter}.`
      : "";
  const content = `${issuedByName} issued ${article(orderName)} ${orderName} on ${legislationTypeName} for ${where}.${transition}`;
  const newsTitle = `${orderName}: ${legislationTypeName}`;
  await createSystemNewsPost(content, "executive", { title: newsTitle });
}

/** Indefinite article — "an" before vowels, "a" otherwise. Both
 *  "Executive Order" and "Order in Council" start with vowels so the call
 *  site always renders "an"; helper keeps phrasing safe across rename. */
function article(noun: string): string {
  return /^[aeiouAEIOU]/.test(noun) ? "an" : "a";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ELECTION_TYPE_LABEL: Record<string, string> = {
  house: "US House",
  senate: "US Senate",
  governor: "Gubernatorial",
  president: "Presidential",
  stateSenate: "State Senate",
  commons: "UK Parliament",
  primeMinister: "Prime Minister",
  dail: "Dáil Éireann",
  seanad: "Seanad Éireann",
  uachtaran: "Uachtarán na hÉireann",
  localCouncil: "IE Local Council",
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
