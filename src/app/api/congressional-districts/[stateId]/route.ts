import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { isRedistrictingEnabled } from "@/lib/redistricting/flag";
import { buildDistrictSquareViews } from "@/lib/redistricting/districtSquareResponse";
import type { CongressionalDistrict, Character, NPP } from "@/lib/db/types";

/**
 * Returns the static congressional-district geometry for a single US
 * state — the same JSON manifest that `subdivision-results` reads internally, but
 * stripped to just `viewBox` + `districts` for client surfaces that
 * render the shapes without needing a tally (e.g. the House-tier primary
 * drilldown).
 *
 * Auth: public
 * Errors: 400 (unknown stateId), 404 (no CD file shipped for the state)
 */
export async function GET(_req: Request, { params }: { params: Promise<{ stateId: string }> }) {
  try {
    const { stateId } = await params;
    const state = stateId.toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) {
      return NextResponse.json({ error: "Invalid state id" }, { status: 400 });
    }

    const filePath = join(process.cwd(), "src", "data", "congressional-districts", `${state}.json`);
    try {
      const raw = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as {
        viewBox: string;
        districts: { cd: string; path: string; cookPVI: number }[];
      };
      const baseDistricts = parsed.districts.map((d) => ({
        cd: d.cd,
        path: d.path,
        cookPVI: d.cookPVI,
      }));

      // Live square overlay — only when the feature flag is on.
      const gs = await getGameState();
      let redistricting:
        { enabled: boolean; districts: ReturnType<typeof buildDistrictSquareViews> } | undefined;
      if (isRedistrictingEnabled(gs)) {
        const db = await getDb();
        const docs = (await db
          .collection<CongressionalDistrict>("congressionalDistricts")
          .find({ countryId: "US", stateId: state })
          .toArray()) as CongressionalDistrict[];

        const holderIds = docs
          .map((d) => d.holderCharacterId)
          .filter((id): id is NonNullable<typeof id> => id != null);
        const holderNppIds = docs
          .map((d) => d.holderNppId)
          .filter((id): id is NonNullable<typeof id> => id != null);
        const holderNames: Record<string, string> = {};
        if (holderIds.length > 0) {
          const chars = (await db
            .collection<Character>("characters")
            .find({ _id: { $in: holderIds } })
            .toArray()) as Character[];
          for (const c of chars) holderNames[String(c._id)] = c.name;
        }
        // NPP holders live in a separate collection, keyed by holderNppId.
        if (holderNppIds.length > 0) {
          const npps = (await db
            .collection<NPP>("npps")
            .find({ _id: { $in: holderNppIds } })
            .toArray()) as NPP[];
          for (const n of npps) holderNames[String(n._id)] = n.name;
        }

        const views = buildDistrictSquareViews(
          parsed.districts.map((d) => d.cd),
          docs,
          holderNames
        );
        redistricting = { enabled: true, districts: views };
      }

      return NextResponse.json({
        viewBox: parsed.viewBox,
        districts: baseDistricts,
        ...(redistricting ? { redistricting } : {}),
      });
    } catch {
      return NextResponse.json({ error: `No CD data available for ${state}` }, { status: 404 });
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
