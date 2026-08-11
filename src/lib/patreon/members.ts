import type { PatreonTier } from "@/lib/db/types";

// Patreon campaign member listing for the supporter reconciler.
//
// Uses a creator access token (PATREON_CREATOR_TOKEN) to page through ALL
// members of the campaign and normalize each into a supporter record the
// reconcile cron can diff against AHD's users collection. Mirrors the
// page-walk logic in the Lakeside account portal (patreon.js) but returns the
// full list keyed by patreonUserId + email rather than a single lookup.
//
// Env:
//   PATREON_CREATOR_TOKEN  creator access token (scopes: identity[email],
//                          campaigns, campaigns.members[.email])
//   PATREON_CAMPAIGN_ID    optional; auto-discovered from the token when unset

const API = "https://www.patreon.com/api/oauth2/v2";
const REQ_TIMEOUT_MS = 10000;

// Real Patreon tier IDs for A House Divided. Ordered by priority (highest paid
// first) so we can pick the strongest entitled tier a member holds.
export const PATREON_SUPPORTER_PLUS_PLUS_TIER_ID = "29087694";
export const PATREON_SUPPORTER_PLUS_TIER_ID = "28289300";
export const PATREON_SUPPORTER_TIER_ID = "28289286";
export const PATREON_FREE_TIER_ID = "28289222";

/** Map a single Patreon tier id to an AHD tier. Free / unknown -> null. */
export function mapMemberTierId(tierId: string | null | undefined): PatreonTier {
  if (tierId === PATREON_SUPPORTER_PLUS_PLUS_TIER_ID) return "supporter-plus-plus";
  if (tierId === PATREON_SUPPORTER_PLUS_TIER_ID) return "supporter-plus";
  if (tierId === PATREON_SUPPORTER_TIER_ID) return "supporter";
  return null;
}

export interface PatreonMemberRecord {
  patreonUserId: string | null;
  email: string | null; // lowercased
  tier: PatreonTier; // highest entitled paid tier, or null (free/none)
  active: boolean; // active_patron AND tier !== null
}

interface TierInfo {
  amountCents: number;
}

function getToken(): string {
  const token = process.env.PATREON_CREATOR_TOKEN?.trim();
  if (!token) {
    throw new Error("PATREON_CREATOR_TOKEN is not set — cannot list Patreon campaign members");
  }
  return token;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(pathAndQuery: string, token: string): Promise<any> {
  const res = await fetch(API + pathAndQuery, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`patreon ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function resolveCampaignId(token: string): Promise<string> {
  const pinned = process.env.PATREON_CAMPAIGN_ID?.trim();
  if (pinned) return pinned;
  const data = await api("/campaigns", token);
  const first = Array.isArray(data?.data) ? data.data[0] : null;
  if (!first?.id) throw new Error("no campaigns visible to this Patreon token");
  return first.id as string;
}

/**
 * Pick the highest-priced entitled tier for a member and map it to an AHD tier.
 * Members can hold several tiers at once (e.g. a Free tier plus a paid one), so
 * we never just take the first — we sort entitled tiers by price and map the top.
 */
function pickTier(entitledTierIds: string[], tiersById: Map<string, TierInfo>): PatreonTier {
  const sorted = [...entitledTierIds].sort(
    (a, b) => (tiersById.get(b)?.amountCents ?? 0) - (tiersById.get(a)?.amountCents ?? 0)
  );
  for (const id of sorted) {
    const mapped = mapMemberTierId(id);
    if (mapped !== null) return mapped;
  }
  return null;
}

/**
 * List ALL campaign members (paid and free), normalized. Throws if the creator
 * token is unset or the Patreon API fails.
 */
export async function listPatreonMembers(): Promise<PatreonMemberRecord[]> {
  const token = getToken();
  const campaignId = await resolveCampaignId(token);

  const fields =
    "fields%5Bmember%5D=patron_status,currently_entitled_amount_cents,email" +
    "&fields%5Buser%5D=email" +
    "&fields%5Btier%5D=title,amount_cents" +
    "&include=currently_entitled_tiers,user";

  let url: string | null = `/campaigns/${encodeURIComponent(
    campaignId
  )}/members?${fields}&page%5Bcount%5D=200`;

  const out: PatreonMemberRecord[] = [];
  let guard = 0;
  while (url && guard++ < 500) {
    const data = await api(url, token);

    const tiersById = new Map<string, TierInfo>();
    const userEmailById = new Map<string, string>();
    for (const inc of data.included || []) {
      if (inc.type === "tier" && inc.attributes) {
        tiersById.set(inc.id, { amountCents: inc.attributes.amount_cents || 0 });
      } else if (inc.type === "user" && inc.attributes?.email) {
        userEmailById.set(inc.id, inc.attributes.email);
      }
    }

    for (const m of data.data || []) {
      const attrs = m.attributes || {};
      const userRel = m.relationships?.user?.data;
      const patreonUserId: string | null = userRel?.id ?? null;

      let email: string | null = attrs.email ?? null;
      if (!email && patreonUserId) email = userEmailById.get(patreonUserId) ?? null;
      email = email ? String(email).toLowerCase() : null;

      const entitledTierIds: string[] = (m.relationships?.currently_entitled_tiers?.data || []).map(
        (t: { id: string }) => t.id
      );
      const tier = pickTier(entitledTierIds, tiersById);

      const active = attrs.patron_status === "active_patron" && tier !== null;

      out.push({ patreonUserId, email, tier, active });
    }

    const next = data.links?.next as string | undefined;
    url = next ? next.replace(API, "") : null;
  }

  return out;
}
