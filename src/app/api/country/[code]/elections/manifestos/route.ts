/**
 * Batch manifesto read for the elections page (epic #856, ticket #857).
 *
 * GET /api/country/[code]/elections/manifestos?electionIds=<id>,<id>,…
 *   → { catalog, pledgeCount, isPartyLeader, party, manifestos } where
 *     `manifestos` is keyed by election id, `null` where the caller's party has
 *     not written one.
 *
 * Why this exists: `ElectionsClient` renders a `ManifestoFlavorBar` per
 * contested Commons race, and each bar used to fetch
 * `…/elections/[electionId]/manifesto` on mount. Every one of those repeated
 * the session auth, the character lookup and the party lookup, and returned an
 * identical `catalog`/`party`/`isPartyLeader` — only `manifesto` differed. On
 * live that was 7,763 requests over 24 elections in 7 days, 19% of all logged
 * API traffic, from one page. This answers the whole page in two queries.
 *
 * The per-election route stays: it still serves POST (save/lock), which is
 * genuinely per-election.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { withNoStore } from "@/lib/api/withNoStore";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { PoliticalParty } from "@/lib/db/types";
import { pledgeCatalogFor } from "@/lib/uk/manifesto/pledgeCatalog";
import { getManifestosForElections } from "@/lib/db/collections/manifestos";
import { MANIFESTO_PLEDGE_COUNT, MAX_MANIFESTO_ELECTION_IDS } from "@/lib/db/types/manifesto";

// withNoStore: the body is per-user (your party, your pledges). The header also
// carries `no-transform`, which stops Cloudflare re-compressing the JSON with
// zstd — an encoding some Android System WebView builds cannot decode, which
// surfaces to the client fetch() as a thrown "Network error" and would make the
// manifesto bars vanish on exactly those devices.
export const GET = withNoStore(
  async (request: Request, { params }: { params: Promise<{ code: string }> }) => {
    try {
      const { code } = await params;
      const countryId = code.toUpperCase() as CountryId;
      if (!COUNTRY_CONFIGS[countryId]) {
        return NextResponse.json({ error: "Invalid country" }, { status: 400 });
      }
      if (countryId !== "UK") {
        return NextResponse.json({ error: "Manifestos are UK-only" }, { status: 400 });
      }

      const raw = new URL(request.url).searchParams.get("electionIds");
      if (!raw) {
        return NextResponse.json({ error: "electionIds is required" }, { status: 400 });
      }
      const requested = raw.split(",").filter(Boolean);
      if (requested.length === 0) {
        return NextResponse.json({ error: "electionIds is required" }, { status: 400 });
      }
      if (requested.length > MAX_MANIFESTO_ELECTION_IDS) {
        return NextResponse.json(
          { error: `At most ${MAX_MANIFESTO_ELECTION_IDS} elections per request` },
          { status: 400 }
        );
      }
      if (!requested.every((id) => ObjectId.isValid(id))) {
        return NextResponse.json({ error: "Invalid electionId" }, { status: 400 });
      }
      // De-duplicate, and remember each id's canonical (lowercase) form against
      // the caller's own spelling. `ObjectId.isValid` accepts uppercase hex,
      // which round-trips to a different string, so replying with
      // `String(row.electionId)` would leave the caller's key null and add one
      // it never asked for. Every key we answer with is a key we were given.
      const originalByCanonical = new Map<string, string>();
      for (const id of requested) originalByCanonical.set(id.toLowerCase(), id);
      const ids = [...originalByCanonical.values()];

      const auth = await requireHumanSessionWithCharacter(request);
      if (!auth.ok) return auth.response;

      const db = await getDb();
      const party = await db
        .collection<PoliticalParty>("politicalParties")
        .findOne({ countryId, chairId: auth.user.character._id });

      const catalog = pledgeCatalogFor(countryId).map((e) => ({
        id: e.id,
        label: e.label,
        blurb: e.blurb,
        policyDomain: e.policyDomain,
      }));

      // Every requested election gets a key, so the client can tell "no manifesto
      // yet" from "not asked for". A non-leader has none by definition, and the
      // manifestos collection is not touched at all.
      const manifestos: Record<string, ManifestoView | null> = Object.fromEntries(
        ids.map((id) => [id, null])
      );

      if (party) {
        const rows = await getManifestosForElections(
          db,
          countryId,
          ids.map((id) => new ObjectId(id)),
          String(party.sequentialId)
        );
        for (const row of rows) {
          const canonical = String(row.electionId).toLowerCase();
          const key = originalByCanonical.get(canonical) ?? canonical;
          manifestos[key] = {
            // A row missing its pledges used to break one bar; batching would
            // make it 500 the whole page, so degrade to "no pledges" instead.
            pledges: (row.pledges ?? []).map((p) => p.catalogEntryId),
            locked: Boolean(row.lockedAt),
            lockedAt: row.lockedAt ? new Date(row.lockedAt).toISOString() : null,
          };
        }
      }

      return NextResponse.json({
        catalog,
        pledgeCount: MANIFESTO_PLEDGE_COUNT,
        isPartyLeader: Boolean(party),
        party: party ? { id: String(party.sequentialId), name: party.name } : null,
        manifestos,
      });
    } catch (err) {
      return handleRouteError(err);
    }
  }
);

interface ManifestoView {
  pledges: string[];
  locked: boolean;
  lockedAt: string | null;
}
