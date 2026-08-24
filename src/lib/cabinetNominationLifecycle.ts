/**
 * Cabinet Nomination Lifecycle
 *
 * Called each turn. Handles:
 *  A. NPP senator votes on active nominations (party-line preference)
 *  B. Close expired votes and resolve confirmed/rejected
 */
import { initialMinisterialActionFields } from "@/lib/cabinet/ministerialActionPool";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { getCabinetPositionById } from "@/lib/constants";
import { didPass } from "@/lib/billLifecycleHelpers";
import { computeCabinetNominationTally } from "@/lib/congress/governmentVoteBreakdown";
import { getOfficeLabel } from "@/lib/utils/politics";
import { getGameState } from "@/lib/gameState";
import { resetCabinetSettingCooldowns } from "@/lib/db/collections/cabinetSettings";
import { getExecutiveOfficialFilter } from "@/lib/elections/executiveOfficeFilters";
import type {
  CabinetNomination,
  CabinetMember,
  ElectedOfficial,
  NPP,
  Character,
  CareerEvent,
} from "@/lib/db/types";
import type { OfficeType } from "@/lib/db/types/character";

/**
 * NPP vote based on party lines: same party as nominee -> for; opposite -> against.
 * Independent/minor party nominee: slight support (55% for).
 *
 * Exported (not just cabinet-internal) so other Senate-confirmation lifecycles
 * built on the same machinery — e.g. SCOTUS justice confirmation, #3598 — reuse
 * this exact party-line behavior instead of re-implementing it.
 */
export function nppCabinetVote(
  nppParty: string | undefined,
  nomineeParty: string | undefined,
  presidentParty: string | undefined
): "for" | "against" | "abstain" {
  if (!nppParty) return "abstain";

  // Same party as nominee -> support
  if (nomineeParty && nppParty === nomineeParty) return "for";

  // Opposite major party -> oppose
  const majorParties = ["democrat", "republican"];
  if (nomineeParty && majorParties.includes(nomineeParty) && majorParties.includes(nppParty)) {
    return "against";
  }

  // Same party as President -> slight support for their pick
  if (presidentParty && nppParty === presidentParty) {
    return Math.random() < 0.7 ? "for" : "abstain";
  }

  // Default: slight support
  return Math.random() < 0.55 ? "for" : "against";
}

interface CabinetNPPPreload {
  nppOfficials: ElectedOfficial[];
  nppMap: Map<string, NPP>;
  presidentParty: string | undefined;
}

export interface CabinetNominationLifecycleResult {
  nominationsProcessed: number;
}

async function castNPPCabinetVotes(
  db: Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>,
  nomination: CabinetNomination,
  preload?: CabinetNPPPreload
): Promise<void> {
  const nppOfficials =
    preload?.nppOfficials ??
    (await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        countryId: nomination.countryId ?? "US",
        officeType: { $in: ["senate", "house"] },
        isNPP: true,
        nppId: { $exists: true },
      })
      .toArray());

  if (nppOfficials.length === 0) return;

  const nppMap =
    preload?.nppMap ??
    (() => {
      const nppIds = nppOfficials
        .map((o) => o.nppId)
        .filter((id): id is ObjectId => id instanceof ObjectId);
      return db
        .collection<NPP>("npps")
        .find({ _id: { $in: nppIds } })
        .toArray()
        .then((npps) => new Map(npps.map((n) => [n._id.toString(), n])));
    })();
  const resolvedNppMap = nppMap instanceof Map ? nppMap : await nppMap;

  const presidentParty =
    preload?.presidentParty ??
    (
      await db.collection<ElectedOfficial>("electedOfficials").findOne({
        countryId: nomination.countryId ?? "US",
        officeType: "president",
        characterId: { $ne: null },
      })
    )?.party;

  const isVpNomination = nomination.positionId === "vicePresident";
  const existingVotes = nomination.votes ?? {};
  const existingHouseVotes = nomination.houseVotes ?? {};
  const now = new Date();
  const voteOps: Array<{ updateOne: { filter: object; update: object } }> = [];

  const seenNppIds = new Set<string>();
  for (const official of nppOfficials) {
    if (!official.nppId) continue;
    const nppIdStr = official.nppId.toString();
    if (seenNppIds.has(nppIdStr)) continue;
    seenNppIds.add(nppIdStr);
    const nppKey = `npp_${nppIdStr}`;

    const npp = resolvedNppMap.get(nppIdStr);
    const nppParty = npp?.party ?? official.party;
    const vote = nppCabinetVote(nppParty, nomination.nomineeParty, presidentParty);
    const weight = official.seatsHeld ?? 1;

    // Senate votes on all nominations; House votes only on VP nominations
    if (official.officeType === "senate" && !existingVotes[nppKey]) {
      const tallyField =
        vote === "for" ? "votesFor" : vote === "against" ? "votesAgainst" : "votesAbstain";
      voteOps.push({
        updateOne: {
          filter: { _id: nomination._id, [`votes.${nppKey}`]: { $exists: false } },
          update: {
            $set: { [`votes.${nppKey}`]: vote, updatedAt: now },
            $inc: { [tallyField]: weight },
          },
        },
      });
    }

    if (isVpNomination && official.officeType === "house" && !existingHouseVotes[nppKey]) {
      const tallyField =
        vote === "for"
          ? "houseVotesFor"
          : vote === "against"
            ? "houseVotesAgainst"
            : "houseVotesAbstain";
      voteOps.push({
        updateOne: {
          filter: { _id: nomination._id, [`houseVotes.${nppKey}`]: { $exists: false } },
          update: {
            $set: { [`houseVotes.${nppKey}`]: vote, updatedAt: now },
            $inc: { [tallyField]: weight },
          },
        },
      });
    }
  }

  if (voteOps.length > 0) {
    await db.collection<CabinetNomination>("cabinetNominations").bulkWrite(voteOps);
  }
}

async function seatConfirmedVicePresident(
  db: Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>,
  nom: CabinetNomination,
  now: Date
): Promise<void> {
  const countryId = nom.countryId ?? "US";

  // Clear the nominee's other seats so they don't hold two offices simultaneously.
  await db.collection<ElectedOfficial>("electedOfficials").updateMany(
    { characterId: nom.nomineeCharacterId, officeType: { $nin: ["president", "vicePresident"] } },
    {
      $set: {
        characterId: null,
        characterName: null,
        party: null,
        isNPP: false,
        updatedAt: now,
      } as Record<string, unknown>,
    }
  );

  // Clear any existing VP holder's currentOffice.
  const existingVp = await db
    .collection<ElectedOfficial>("electedOfficials")
    .findOne(getExecutiveOfficialFilter(countryId, "vicePresident"));
  if (existingVp?.characterId) {
    await db
      .collection<Character>("characters")
      .updateOne(
        { _id: existingVp.characterId },
        { $set: { currentOffice: null, updatedAt: now } }
      );
  }

  // Seat the nominee as VP in electedOfficials.
  await db.collection<ElectedOfficial>("electedOfficials").updateOne(
    getExecutiveOfficialFilter(countryId, "vicePresident"),
    {
      $set: {
        countryId,
        characterId: nom.nomineeCharacterId,
        characterName: nom.nomineeCharacterName,
        party: nom.nomineeParty,
        isNPP: false,
        electedAt: now,
        updatedAt: now,
      },
      $unset: { nppId: "" },
    },
    { upsert: true }
  );

  const vpOffice: OfficeType = { type: "vicePresident" };
  const vpCareer: CareerEvent = {
    type: "appointed",
    office: vpOffice,
    officeLabel: getOfficeLabel(vpOffice, countryId),
    party: nom.nomineeParty,
    partyCountryId: countryId,
    date: now,
  };
  await db.collection<Character>("characters").updateOne(
    { _id: nom.nomineeCharacterId },
    {
      $set: { currentOffice: vpOffice, updatedAt: now },
      $push: { careerHistory: vpCareer },
    }
  );
}

export async function processCabinetNominationLifecycle(
  now: Date
): Promise<CabinetNominationLifecycleResult> {
  const db = await getDb();
  const gameState = await getGameState();
  const currentTurn = gameState?.currentTurn ?? 1;

  // Pre-fetch US NPP officials and NPPs once. This preload is US-scoped and is
  // ONLY reused for US nominations below; non-US nominations (e.g. NG) resolve
  // their own country-scoped NPP officials/president inside castNPPCabinetVotes
  // so foreign votes maps are not polluted with US NPP senators. See ticket #923.
  const [nppOfficials, president] = await Promise.all([
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        countryId: "US",
        officeType: { $in: ["senate", "house"] },
        isNPP: true,
        nppId: { $exists: true },
      })
      .toArray(),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ countryId: "US", officeType: "president", characterId: { $ne: null } }),
  ]);
  const nppIds = nppOfficials
    .map((o) => o.nppId)
    .filter((id): id is ObjectId => id instanceof ObjectId);
  const npps =
    nppIds.length > 0
      ? await db
          .collection<NPP>("npps")
          .find({ _id: { $in: nppIds } })
          .toArray()
      : [];
  const nppMap = new Map(npps.map((n) => [n._id.toString(), n]));
  const cabinetPreload: CabinetNPPPreload = {
    nppOfficials,
    nppMap,
    presidentParty: president?.party,
  };

  // ── A. NPP catch-up votes on active nominations ─────────────────────────────
  // Turn-number first, date fallback for legacy nominations.
  const activeNominations = await db
    .collection<CabinetNomination>("cabinetNominations")
    .find({
      status: "active",
      $or: [
        { votingEndsOnTurn: { $gt: currentTurn } },
        { votingEndsOnTurn: { $exists: false }, votingEndsAt: { $gt: now } },
      ],
    })
    .toArray();

  for (const nom of activeNominations) {
    const preload = (nom.countryId ?? "US") === "US" ? cabinetPreload : undefined;
    await castNPPCabinetVotes(db, nom, preload);
  }

  // ── B. Close expired votes ───────────────────────────────────────────────
  const expired = await db
    .collection<CabinetNomination>("cabinetNominations")
    .find({
      status: "active",
      $or: [
        { votingEndsOnTurn: { $lte: currentTurn } },
        { votingEndsOnTurn: { $exists: false }, votingEndsAt: { $lte: now } },
      ],
    })
    .toArray();

  const notificationInputs: NotificationInput[] = [];

  for (const nom of expired) {
    // Decide from the seat-weighted recompute scoped to the country's current
    // senate seats — drops de-seated and cross-country NPP votes that drifted
    // the cached counters above the 100-seat chamber.
    const reTally = await computeCabinetNominationTally(
      db,
      nom.countryId ?? "US",
      nom.votes,
      nom.houseVotes
    );
    const isVpNomination = nom.positionId === "vicePresident";

    let passed: boolean;
    if (isVpNomination) {
      // VP nominations require majority in BOTH House and Senate (25th Amendment)
      const senatePassed = didPass(reTally.votesFor, reTally.votesAgainst);
      const housePassed = didPass(reTally.houseVotesFor ?? 0, reTally.houseVotesAgainst ?? 0);
      passed = senatePassed && housePassed;
    } else {
      // Cabinet nominations: Senate only
      passed = didPass(reTally.votesFor, reTally.votesAgainst);
    }

    if (passed) {
      // VP nominations seat the character as VP; all other positions create a CabinetMember.
      if (nom.positionId === "vicePresident") {
        await seatConfirmedVicePresident(db, nom, now);
      } else {
        // Confirm: create or replace cabinet member
        await db
          .collection<CabinetMember>("cabinetMembers")
          .deleteOne({ positionId: nom.positionId });

        const member: Omit<CabinetMember, "_id"> & {
          ministerialActions: number;
          lastMinisterialActionResetDay: string;
        } = {
          countryId: nom.countryId,
          positionId: nom.positionId,
          characterId: nom.nomineeCharacterId,
          characterName: nom.nomineeCharacterName,
          party: nom.nomineeParty,
          appointedByPresidentId: nom.proposedByPresidentId,
          confirmedAt: now,
          ...initialMinisterialActionFields(now),
          createdAt: now,
          updatedAt: now,
        };
        await db
          .collection<CabinetMember>("cabinetMembers")
          .insertOne(member as unknown as CabinetMember);

        // Clear the predecessor's setting cooldowns so the new secretary can change
        // settings immediately (cabinetSettings is keyed by position, not holder).
        await resetCabinetSettingCooldowns(db, nom.countryId ?? "US", nom.positionId);

        // Add career history entry for cabinet confirmation.
        // Only US flows through the cabinetNominations lifecycle (Senate
        // confirmation). UK/JP/DE/CN parliamentary cabinets are appointed
        // directly via /api/country/[code]/executive/cabinet/appoint and
        // record their own career history there. The DE branch here was
        // leftover from an earlier design that routed DE through
        // nominations; removing it keeps the parliamentary appointment
        // flow uniform across UK/JP/DE/CN.
        if (nom.countryId === "US") {
          const cabinetOffice: OfficeType = { type: "usCabinet", positionId: nom.positionId };
          const careerEvent: CareerEvent = {
            type: "appointed",
            office: cabinetOffice,
            officeLabel: getOfficeLabel(cabinetOffice, nom.countryId),
            party: nom.nomineeParty,
            partyCountryId: nom.countryId,
            date: now,
          };
          await db
            .collection<Character>("characters")
            .updateOne({ _id: nom.nomineeCharacterId }, { $push: { careerHistory: careerEvent } });
        }
      }

      await db.collection<CabinetNomination>("cabinetNominations").updateOne(
        { _id: nom._id },
        {
          $set: {
            status: "confirmed",
            confirmedAt: now,
            updatedAt: now,
            votesFor: reTally.votesFor,
            votesAgainst: reTally.votesAgainst,
            votesAbstain: reTally.votesAbstain,
            ...(nom.positionId === "vicePresident" && {
              houseVotesFor: reTally.houseVotesFor,
              houseVotesAgainst: reTally.houseVotesAgainst,
              houseVotesAbstain: reTally.houseVotesAbstain,
            }),
          },
        }
      );

      // Notify President and nominee
      const presidentChar = await db
        .collection<Character>("characters")
        .findOne({ _id: nom.proposedByPresidentId });
      const nomineeChar = await db
        .collection<Character>("characters")
        .findOne({ _id: nom.nomineeCharacterId });
      const isVpNomination = nom.positionId === "vicePresident";
      const posName = isVpNomination
        ? "Vice President"
        : (getCabinetPositionById(nom.positionId)?.name ?? nom.positionId);
      const confirmTitle = isVpNomination ? "VP Confirmed" : "Cabinet Confirmed";
      if (presidentChar?.userId) {
        notificationInputs.push({
          userId: presidentChar.userId,
          type: "system",
          title: confirmTitle,
          message: `${nom.nomineeCharacterName} was confirmed as ${posName}.`,
          metadata: {
            nominationId: nom._id.toString(),
            type: isVpNomination ? "vp_confirmed" : "cabinet_confirmed",
            recipientCharacterId: presidentChar._id.toString(),
          },
        });
      }
      if (nomineeChar?.userId && !nomineeChar._id.equals(nom.proposedByPresidentId)) {
        notificationInputs.push({
          userId: nomineeChar.userId,
          type: "system",
          title: confirmTitle,
          message: `You were confirmed as ${posName}.`,
          metadata: {
            nominationId: nom._id.toString(),
            type: isVpNomination ? "vp_confirmed" : "cabinet_confirmed",
            recipientCharacterId: nomineeChar._id.toString(),
          },
        });
      }
    } else {
      // Rejected
      await db.collection<CabinetNomination>("cabinetNominations").updateOne(
        { _id: nom._id },
        {
          $set: {
            status: "rejected",
            rejectedAt: now,
            updatedAt: now,
            votesFor: reTally.votesFor,
            votesAgainst: reTally.votesAgainst,
            votesAbstain: reTally.votesAbstain,
            ...(nom.positionId === "vicePresident" && {
              houseVotesFor: reTally.houseVotesFor,
              houseVotesAgainst: reTally.houseVotesAgainst,
              houseVotesAbstain: reTally.houseVotesAbstain,
            }),
          },
        }
      );

      const isVpRejection = nom.positionId === "vicePresident";
      const posName = isVpRejection
        ? "Vice President"
        : (getCabinetPositionById(nom.positionId)?.name ?? nom.positionId);
      const presidentChar = await db
        .collection<Character>("characters")
        .findOne({ _id: nom.proposedByPresidentId });
      if (presidentChar?.userId) {
        notificationInputs.push({
          userId: presidentChar.userId,
          type: "system",
          title: isVpRejection ? "VP Nomination Rejected" : "Cabinet Nomination Rejected",
          message: `${nom.nomineeCharacterName} was not confirmed for ${posName}.`,
          metadata: {
            nominationId: nom._id.toString(),
            type: isVpRejection ? "vp_rejected" : "cabinet_rejected",
            recipientCharacterId: presidentChar._id.toString(),
          },
        });
      }
    }
  }

  await createNotifications(notificationInputs);

  return {
    nominationsProcessed: activeNominations.length + expired.length,
  };
}
