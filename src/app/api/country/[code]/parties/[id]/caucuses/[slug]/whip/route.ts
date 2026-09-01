import { NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { findCaucusBySlug, listCaucusMemberships } from "@/lib/db/caucusLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  getPMAppointmentVotesCollection,
  getNoConfidenceVotesCollection,
} from "@/lib/db/collections/governmentFormation";
import {
  applyWhipVotesToBill,
  applyWhipVotesToLeadership,
  applyWhipVotesToGovernmentVote,
  applyWhipVotesToCabinet,
  applyWhipVotesToVacateMotion,
  applyWhipVotesToImpeachment,
} from "@/lib/congress/applyWhipVotes";
import { statecraftWhipBonus } from "@/lib/partyWhips/whipSuccess";
import { USE_GROWTH_INCREMENT } from "@/lib/stats/statsConstants";
import {
  applyPlayerWhipToBill,
  applyPlayerWhipToCabinet,
  applyPlayerWhipToGovernmentVote,
  applyPlayerWhipToLeadership,
  applyPlayerWhipToVacateMotion,
  applyPlayerWhipToImpeachment,
} from "@/lib/congress/applyPlayerWhip";
import { sendSystemMail } from "@/lib/mail/systemMail";
import { createNotification } from "@/lib/notifications";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import {
  getCabinetWhipChamber,
  getConfidenceWhipChamber,
  isWhippableChamber,
  getChamberLeaderRole,
} from "@/lib/partyWhips/constraints";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import { getGameTime } from "@/lib/time/gameTime";
import { isLeadershipElectionClosed } from "@/lib/congress/leadershipElections";
import { impeachmentStageChamberKey } from "@/lib/impeachment/impeachmentTally";
import type { Impeachment } from "@/lib/db/types/impeachment";
import type {
  Bill,
  BillWhip,
  CabinetNomination,
  Character,
  ElectedOfficial,
  GameState,
  LegislationType,
  NPP,
  PlayerWhipMode,
  SpeakerVacateMotion,
  StateDemographics,
  User,
  WhipIssuerRole,
} from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ code: string; id: string; slug: string }>;
}

const whipSchema = z.object({
  targetType: z.enum([
    "bill",
    "speakerElection",
    "leadershipElection",
    "pmAppointmentVote",
    "noConfidenceVote",
    "cabinetNomination",
    "speakerVacateMotion",
    "impeachmentVote",
  ]),
  targetId: z.string().min(1, "Target ID required"),
  chamber: z.string().min(1, "Chamber required"),
  direction: z.enum(["for", "against"]),
  mode: z.enum(["soft", "hard"]).default("hard"),
  candidacyId: z
    .string()
    .regex(/^[a-f\d]{24}$/i, "Invalid candidacy ID")
    .optional(),
  audience: z.enum(["npp", "character"]).default("npp"),
});

async function getEligibleCaucusCharactersForWhip(
  db: Db,
  countryId: CountryId,
  partyId: string,
  chamber: string,
  caucusCharacterIds: ObjectId[],
  stateId?: string
): Promise<ObjectId[]> {
  if (caucusCharacterIds.length === 0) return [];

  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({
      isNPP: false,
      party: partyId,
      // CN: resolve chamber key "npc" → office type "npcDelegate" (no-op for
      // other countries) so caucus officials actually match.
      officeType: getOfficeTypeForChamber(countryId, chamber),
      countryId,
      ...(stateId ? { state: stateId } : {}),
      characterId: { $in: caucusCharacterIds },
    })
    .toArray();

  if (officials.length === 0) return [];
  const characterIds = officials
    .map((official) => official.characterId)
    .filter((id): id is ObjectId => id != null);
  if (characterIds.length === 0) return [];

  const characters = await db
    .collection<Character>("characters")
    .find({ _id: { $in: characterIds } })
    .project<{ _id: ObjectId; userId: ObjectId }>({ _id: 1, userId: 1 })
    .toArray();

  const userIdsByChar = new Map(
    characters.map((character) => [character._id.toString(), character.userId])
  );
  const userIds = Array.from(
    new Set(characters.map((character) => character.userId.toString()))
  ).map((id) => characters.find((character) => character.userId.toString() === id)!.userId);

  const bannedUsers = await db
    .collection<User>("users")
    .find({ _id: { $in: userIds }, isBanned: true })
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();
  const bannedUserIds = new Set(bannedUsers.map((user) => user._id.toString()));

  return characterIds.filter((characterId) => {
    const userId = userIdsByChar.get(characterId.toString());
    if (!userId) return false;
    return !bannedUserIds.has(userId.toString());
  });
}

async function buildCaucusPlayerWhipMessage(
  db: Db,
  caucusName: string,
  targetType: string,
  targetId: ObjectId | string,
  direction: "for" | "against",
  mode: PlayerWhipMode
): Promise<{ subject: string; body: string; notificationTitle: string }> {
  const dir = direction === "for" ? "AYE" : "NAY";
  const isSoft = mode === "soft";
  const notificationTitle = isSoft ? "Caucus vote recommendation" : "Caucus whip issued";
  const prefix = isSoft ? `${caucusName} suggests` : `${caucusName} has whipped you`;

  if (targetType === "bill" && targetId instanceof ObjectId) {
    const bill = await db
      .collection<Bill>("bills")
      .findOne({ _id: targetId }, { projection: { title: 1 } });
    const title = bill?.title ?? "a bill";
    return {
      subject: isSoft
        ? `${caucusName}: Vote ${dir} on "${title}"`
        : `${caucusName} whip: Vote ${dir} on "${title}"`,
      body: isSoft
        ? `${prefix} you vote ${dir} on "${title}". Review the bill page if you want to follow the recommendation.`
        : `${prefix} to vote ${dir} on "${title}". You may change your vote at any time by visiting the bill's voting page.`,
      notificationTitle,
    };
  }

  const targetLabel =
    targetType === "pmAppointmentVote"
      ? "the PM appointment vote"
      : targetType === "noConfidenceVote"
        ? "the no-confidence motion"
        : targetType === "cabinetNomination"
          ? "the cabinet nomination"
          : targetType === "speakerVacateMotion"
            ? "the motion to vacate the chair"
            : targetType === "impeachmentVote"
              ? "the impeachment"
              : "the assigned leadership vote";

  return {
    subject: isSoft ? `${caucusName}: Vote ${dir}` : `${caucusName} whip: Vote ${dir}`,
    body: isSoft
      ? `${prefix} you vote ${dir} on ${targetLabel}.`
      : `${prefix} to vote ${dir} on ${targetLabel}. You may change your vote at any time.`,
    notificationTitle,
  };
}

// POST /api/country/[code]/parties/[id]/caucuses/[slug]/whip — Issue a caucus-only whip directive for bills and leadership votes
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId, slug } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, whipSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { targetType, targetId, chamber, direction, mode, candidacyId, audience } = parsed.data;
    if (!isWhippableChamber(countryId, chamber)) {
      return NextResponse.json(badRequest("Invalid chamber for this country").toJson(), {
        status: 400,
      });
    }
    const db = await getDb();

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json(notFound("Party not found").toJson(), { status: 404 });
    }
    const partyIdStr = String(party.sequentialId);

    const resolved = await findCaucusBySlug(db, countryId, partyIdStr, slug);
    if (!resolved) {
      return NextResponse.json(notFound("Caucus not found").toJson(), { status: 404 });
    }
    const { caucus } = resolved;

    const isChair = caucus.chairId?.equals(authResult.user.character._id) ?? false;
    const isAdmin = Boolean(authResult.user.isAdmin);
    const chamberLeaderRole = await getChamberLeaderRole(
      db,
      authResult.user.character._id,
      chamber,
      partyIdStr
    );
    const issuerRole: WhipIssuerRole =
      chamberLeaderRole ?? (isChair ? "chair" : isAdmin ? "admin" : "chair");

    if (!isChair && !isAdmin && !chamberLeaderRole) {
      return NextResponse.json(
        forbidden("Only the Caucus Chair or chamber leadership can issue caucus whips").toJson(),
        {
          status: 403,
        }
      );
    }

    const memberships = await listCaucusMemberships(db, caucus._id);
    const caucusCharacterIds = memberships
      .filter((membership) => membership.memberType === "character")
      .map((membership) => membership.memberId);
    const caucusNppIds = memberships
      .filter((membership) => membership.memberType === "npp")
      .map((membership) => membership.memberId);

    const confidenceChamber = getConfidenceWhipChamber(countryId);
    const cabinetChamber = getCabinetWhipChamber(countryId);
    // The motion to vacate is a singleton keyed "current"; pin it server-side so
    // a client cannot address some other document through this target type.
    const normalizedTargetId =
      targetType === "speakerVacateMotion"
        ? "current"
        : countryId === COUNTRY_CONFIGS.US.id &&
            targetType === "speakerElection" &&
            targetId === "current"
          ? "current"
          : targetId;
    const targetOid = ObjectId.isValid(normalizedTargetId)
      ? new ObjectId(normalizedTargetId)
      : null;
    const isUSCongressLeadershipTarget =
      countryId === COUNTRY_CONFIGS.US.id &&
      (targetType === "speakerElection" || targetType === "leadershipElection");
    const storedTargetId: ObjectId | string =
      isUSCongressLeadershipTarget || targetType === "speakerVacateMotion"
        ? normalizedTargetId
        : (targetOid ?? normalizedTargetId);

    // Leadership-style targets reuse a stable _id ("current" for the Speaker
    // election and the vacate motion, the role name for chamber leaders), so
    // whips from a previous instance would otherwise count against the current
    // one's attempt cap and freeze the panel (ticket #959). Each branch below
    // sets this to the instant its target opened.
    let whipWindowStart: Date | undefined;
    const requireTargetObjectId = (): ObjectId => {
      if (!targetOid) throw badRequest("Invalid target ID");
      return targetOid;
    };

    // Speaker/leadership-election whips route to US-only collections in the
    // apply phase. Reject for German chambers, which use PM appointment /
    // no-confidence votes for executive selection.
    if (
      (targetType === "speakerElection" || targetType === "leadershipElection") &&
      (chamber === "bundestag" || chamber === "landtag")
    ) {
      return NextResponse.json(
        badRequest(
          "Leadership election whips are not supported for German chambers. Use PM appointment or no-confidence vote whips instead."
        ).toJson(),
        { status: 400 }
      );
    }

    let billStateId: string | undefined;
    if (targetType === "bill") {
      if (!targetOid) {
        return NextResponse.json(badRequest("Invalid target ID").toJson(), { status: 400 });
      }
      const bill = await db.collection<Bill>("bills").findOne({
        _id: targetOid,
        status: {
          $in: ["active", "active_other", "active_both", "veto_override", "override_shugiin"],
        },
        $or: [{ countryId }, { countryId: { $exists: false } }],
      });
      if (!bill) {
        return NextResponse.json(notFound("Bill not found or voting not open").toJson(), {
          status: 404,
        });
      }
      billStateId = bill.stateId;
    } else if (targetType === "speakerElection") {
      const speakerElection = isUSCongressLeadershipTarget
        ? normalizedTargetId === "current"
          ? await db
              .collection<{ _id: string; status: string; startedAt?: Date }>("speakerElections")
              .findOne({
                _id: "current",
                status: "voting",
              })
          : null
        : targetOid
          ? await db.collection("speakerElections").findOne({ _id: targetOid, status: "active" })
          : null;
      if (!speakerElection) {
        return NextResponse.json(notFound("Speaker election not found or not active").toJson(), {
          status: 404,
        });
      }
      if (isUSCongressLeadershipTarget) {
        whipWindowStart = (speakerElection as { startedAt?: Date }).startedAt;
      }
      if (!candidacyId) {
        return NextResponse.json(badRequest("candidacyId required for leadership whips").toJson(), {
          status: 400,
        });
      }
    } else if (targetType === "leadershipElection") {
      const leadershipElection = isUSCongressLeadershipTarget
        ? await db
            .collection<{
              _id: string;
              status: string;
              startedAt?: Date;
            }>(chamber === "senate" ? "senateLeadershipElections" : "houseLeadershipElections")
            .findOne({ _id: normalizedTargetId, status: "voting" })
        : targetOid
          ? await db.collection("leadershipElections").findOne({ _id: targetOid, status: "active" })
          : null;
      if (!leadershipElection) {
        return NextResponse.json(notFound("Leadership election not found or not active").toJson(), {
          status: 404,
        });
      }
      if (isUSCongressLeadershipTarget) {
        whipWindowStart = (leadershipElection as { startedAt?: Date }).startedAt;
      }
      if (!candidacyId) {
        return NextResponse.json(badRequest("candidacyId required for leadership whips").toJson(), {
          status: 400,
        });
      }
    } else if (targetType === "pmAppointmentVote") {
      if (!targetOid) {
        return NextResponse.json(badRequest("Invalid target ID").toJson(), { status: 400 });
      }
      const pmVote = await getPMAppointmentVotesCollection(db).findOne({
        _id: targetOid,
        status: "active",
      });
      if (!pmVote || pmVote.countryId !== countryId) {
        return NextResponse.json(notFound("PM appointment vote not found or not active").toJson(), {
          status: 404,
        });
      }
      if (chamber !== confidenceChamber) {
        return NextResponse.json(
          badRequest(
            `PM appointment votes can only be whipped in the ${confidenceChamber}`
          ).toJson(),
          { status: 400 }
        );
      }
    } else if (targetType === "noConfidenceVote") {
      if (!targetOid) {
        return NextResponse.json(badRequest("Invalid target ID").toJson(), { status: 400 });
      }
      const ncVote = await getNoConfidenceVotesCollection(db).findOne({
        _id: targetOid,
        status: "active",
      });
      if (!ncVote || ncVote.countryId !== countryId) {
        return NextResponse.json(notFound("No-confidence vote not found or not active").toJson(), {
          status: 404,
        });
      }
      if (chamber !== confidenceChamber) {
        return NextResponse.json(
          badRequest(
            `No-confidence votes can only be whipped in the ${confidenceChamber}`
          ).toJson(),
          { status: 400 }
        );
      }
    } else if (targetType === "speakerVacateMotion") {
      if (countryId !== COUNTRY_CONFIGS.US.id) {
        return NextResponse.json(
          badRequest("Motions to vacate are only held in the US House").toJson(),
          { status: 400 }
        );
      }
      if (chamber !== confidenceChamber) {
        return NextResponse.json(
          badRequest(`Motions to vacate can only be whipped in the ${confidenceChamber}`).toJson(),
          { status: 400 }
        );
      }
      const motion = await db
        .collection<SpeakerVacateMotion>("speakerVacateMotions")
        .findOne({ _id: "current", status: "voting" });
      // Resolution is lazy (on read of the Speaker page), so a motion can sit in
      // "voting" past its deadline. Gate on the clock as well as the status, or
      // a chair could whip a motion that is already over.
      const vacateGameTime = motion ? await getGameTime() : null;
      if (
        !motion ||
        !vacateGameTime ||
        isLeadershipElectionClosed(motion, vacateGameTime.currentTurn, vacateGameTime.effectiveNow)
      ) {
        return NextResponse.json(notFound("No motion to vacate is currently open").toJson(), {
          status: 404,
        });
      }
      whipWindowStart = motion.startedAt;
    } else if (targetType === "impeachmentVote") {
      if (!targetOid) {
        return NextResponse.json(badRequest("Invalid target ID").toJson(), { status: 400 });
      }
      const impeachment = await db
        .collection<Impeachment>("impeachments")
        .findOne({ _id: targetOid, countryId, stage: { $in: ["house", "senate"] } });
      if (!impeachment) {
        return NextResponse.json(
          notFound("Impeachment not found or no longer open for voting").toJson(),
          { status: 404 }
        );
      }
      if (impeachment.targetOffice === "governor") {
        return NextResponse.json(
          badRequest("Governor impeachments are whipped from the state party").toJson(),
          { status: 400 }
        );
      }
      const stageChamber = impeachmentStageChamberKey(impeachment);
      if (!stageChamber || chamber !== stageChamber) {
        return NextResponse.json(
          badRequest(
            `This impeachment is being voted in the ${stageChamber ?? "no open"} chamber`
          ).toJson(),
          { status: 400 }
        );
      }
      const stageEndsOnTurn =
        impeachment.stage === "house"
          ? impeachment.houseVotingEndsOnTurn
          : impeachment.senateVotingEndsOnTurn;
      const impeachGameTime = await getGameTime();
      if (stageEndsOnTurn != null && impeachGameTime.currentTurn > stageEndsOnTurn) {
        return NextResponse.json(
          notFound("Voting for this impeachment stage has closed").toJson(),
          { status: 404 }
        );
      }
    } else if (targetType === "cabinetNomination") {
      if (!targetOid) {
        return NextResponse.json(badRequest("Invalid target ID").toJson(), { status: 400 });
      }
      const nomination = await db.collection<CabinetNomination>("cabinetNominations").findOne({
        _id: targetOid,
        status: "active",
      });
      if (!nomination || nomination.countryId !== countryId) {
        return NextResponse.json(notFound("Cabinet nomination not found or not active").toJson(), {
          status: 404,
        });
      }
      if (chamber !== cabinetChamber) {
        return NextResponse.json(
          badRequest(`Cabinet nominations can only be whipped in the ${cabinetChamber}`).toJson(),
          { status: 400 }
        );
      }
    }

    const existingWhips = await db
      .collection<BillWhip>("billWhips")
      .find({
        targetType,
        targetId: storedTargetId,
        chamber,
        partyId: partyIdStr,
        issuedBy: "caucus",
        caucusId: caucus._id,
        ...(audience === "npp"
          ? { $or: [{ audience: "npp" }, { audience: { $exists: false } }] }
          : {}),
        ...(whipWindowStart ? { createdAt: { $gte: whipWindowStart } } : {}),
      })
      .toArray();

    if (audience === "npp" && existingWhips.length >= 2) {
      return NextResponse.json(
        badRequest("Maximum 2 whip attempts per bill/chamber reached").toJson(),
        { status: 400 }
      );
    }

    if (audience === "character") {
      const existingCharacterWhips = await db
        .collection<BillWhip>("billWhips")
        .find({
          targetType,
          targetId: storedTargetId,
          chamber,
          partyId: partyIdStr,
          issuedBy: "caucus",
          caucusId: caucus._id,
          audience: "character",
          ...(whipWindowStart ? { createdAt: { $gte: whipWindowStart } } : {}),
        })
        .toArray();
      const existingSameModeWhip = existingCharacterWhips.find(
        (whip) => (whip.mode ?? "hard") === mode
      );
      if (existingSameModeWhip) {
        return NextResponse.json(
          badRequest(
            `A ${mode === "soft" ? "Soft" : "Hard"} Player Whip has already been issued on this target`
          ).toJson(),
          { status: 400 }
        );
      }

      const eligible = await getEligibleCaucusCharactersForWhip(
        db,
        countryId,
        partyIdStr,
        chamber,
        caucusCharacterIds,
        chamber === "stateSenate" ? billStateId : undefined
      );
      const playerWhipDoc: Omit<BillWhip, "_id"> = {
        targetType,
        targetId: storedTargetId,
        chamber,
        direction,
        candidacyId: candidacyId ? new ObjectId(candidacyId) : undefined,
        issuedBy: "caucus",
        caucusId: caucus._id,
        countryId,
        stateId: chamber === "stateSenate" ? billStateId : undefined,
        partyId: partyIdStr,
        issuedByCharacterId: authResult.user.character._id,
        issuedByRole: issuerRole,
        audience: "character",
        mode,
        attemptNumber: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const insert = await db
        .collection<BillWhip>("billWhips")
        .insertOne(playerWhipDoc as BillWhip);

      let overridden = 0;
      let alreadyAligned = 0;
      if (mode === "hard") {
        if (targetType === "bill") {
          const bill = await db
            .collection<Bill>("bills")
            .findOne({ _id: requireTargetObjectId(), countryId });
          if (bill) {
            const result = await applyPlayerWhipToBill(db, bill, direction, eligible);
            overridden = result.overridden;
            alreadyAligned = result.alreadyAligned;
          }
        } else if (
          (targetType === "speakerElection" || targetType === "leadershipElection") &&
          candidacyId
        ) {
          const collectionName =
            targetType === "speakerElection"
              ? "speakerNominations"
              : chamber === "senate"
                ? "senateLeadershipNominations"
                : "houseLeadershipNominations";
          const result = await applyPlayerWhipToLeadership(
            db,
            new ObjectId(candidacyId),
            collectionName,
            eligible
          );
          overridden = result.overridden;
          alreadyAligned = result.alreadyAligned;
        } else if (targetType === "pmAppointmentVote" || targetType === "noConfidenceVote") {
          const result = await applyPlayerWhipToGovernmentVote(
            db,
            requireTargetObjectId(),
            targetType,
            direction,
            eligible
          );
          overridden = result.overridden;
          alreadyAligned = result.alreadyAligned;
        } else if (targetType === "cabinetNomination") {
          const result = await applyPlayerWhipToCabinet(
            db,
            requireTargetObjectId(),
            direction,
            eligible
          );
          overridden = result.overridden;
          alreadyAligned = result.alreadyAligned;
        } else if (targetType === "speakerVacateMotion") {
          const result = await applyPlayerWhipToVacateMotion(db, direction, eligible);
          overridden = result.overridden;
          alreadyAligned = result.alreadyAligned;
        } else if (targetType === "impeachmentVote") {
          const result = await applyPlayerWhipToImpeachment(
            db,
            requireTargetObjectId(),
            direction,
            eligible
          );
          overridden = result.overridden;
          alreadyAligned = result.alreadyAligned;
        }
      }

      const { subject, body, notificationTitle } = await buildCaucusPlayerWhipMessage(
        db,
        caucus.name,
        targetType,
        storedTargetId,
        direction,
        mode
      );

      const characterDocs =
        eligible.length > 0
          ? await db
              .collection<Character>("characters")
              .find({ _id: { $in: eligible } })
              .project<{
                _id: ObjectId;
                name: string;
                userId: ObjectId;
                sequentialId?: number;
              }>({ _id: 1, name: 1, userId: 1, sequentialId: 1 })
              .toArray()
          : [];

      let mailedCount = 0;
      for (const character of characterDocs) {
        try {
          if (mode === "hard") {
            await sendSystemMail(db, {
              toCharacterId: character._id,
              toCharacterName: character.name,
              toCharacterSequentialId: character.sequentialId ?? 0,
              toUserId: character.userId,
              subject,
              body,
              senderName: `${caucus.name} Caucus`,
            });
          }
          await createNotification({
            userId: character.userId,
            type: "party_whip_issued",
            title: notificationTitle,
            message: subject,
            metadata: {
              targetType,
              targetId:
                typeof storedTargetId === "string" ? storedTargetId : storedTargetId.toString(),
              direction,
              mode,
              caucusId: caucus._id.toString(),
            },
          });
          mailedCount++;
        } catch (error) {
          console.warn(
            "[caucus-player-whip] Failed to notify character",
            String(character._id),
            error
          );
        }
      }

      return NextResponse.json({
        success: true,
        whipId: insert.insertedId.toString(),
        audience: "character",
        mode,
        affected: overridden,
        alreadyAligned,
        mailedCount,
        message:
          mode === "soft"
            ? `Soft caucus whip issued. ${mailedCount} caucus players notified.`
            : `Hard caucus whip issued. ${overridden} caucus players overridden, ${alreadyAligned} already aligned, ${mailedCount} notified.`,
      });
    }

    const attemptNumber = (existingWhips.length + 1) as 1 | 2;
    const whipDoc: Omit<BillWhip, "_id"> = {
      targetType,
      targetId: storedTargetId,
      chamber,
      direction,
      mode,
      candidacyId: candidacyId ? new ObjectId(candidacyId) : undefined,
      issuedBy: "caucus",
      caucusId: caucus._id,
      countryId,
      stateId: chamber === "stateSenate" ? billStateId : undefined,
      partyId: partyIdStr,
      issuedByCharacterId: authResult.user.character._id,
      issuedByRole: issuerRole,
      audience: "npp",
      attemptNumber,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const insert = await db.collection<BillWhip>("billWhips").insertOne(whipDoc as BillWhip);

    const nppOfficials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        isNPP: true,
        // Country-scope the officials. `caucusNppIds` already implies a single
        // country, but party sequentialIds collide across countries — keep the
        // filter explicit and uniform with the other whip routes (bug #0699).
        countryId,
        party: partyIdStr,
        // Resolve the chamber key to the office type members are stored under
        // (CN: "npc" → "npcDelegate"), else the caucus whip on a CN federal bill
        // matches zero delegates and falls on nobody.
        officeType: getOfficeTypeForChamber(countryId, chamber),
        ...(chamber === "stateSenate" && billStateId ? { state: billStateId } : {}),
        nppId: { $in: caucusNppIds },
      })
      .toArray();
    const nppIds = nppOfficials
      .map((official) => official.nppId)
      .filter((id): id is ObjectId => !!id);
    const npps =
      nppIds.length > 0
        ? await db
            .collection<NPP>("npps")
            .find({ _id: { $in: nppIds } })
            .toArray()
        : [];
    const nppMap = new Map(npps.map((npp) => [npp._id.toString(), npp]));

    let fellInLine = 0;
    let ignored = 0;
    // Statecraft sharpens a caucus chair's whip and trains the stat (use-growth).
    const actorCharacter = authResult.user.character;
    const whipStatecraftBonus = statecraftWhipBonus(actorCharacter.stats?.statecraft);
    const grantStatecraftXp = async () => {
      await db
        .collection("characters")
        .updateOne(
          { _id: actorCharacter._id },
          { $inc: { "statXp.statecraft": USE_GROWTH_INCREMENT } }
        );
    };
    if (targetType === "bill") {
      const bill = await db
        .collection<Bill>("bills")
        .findOne({ _id: requireTargetObjectId(), countryId });
      if (bill) {
        const [legislationType, stateDemographicsArr, gameStateDoc] = await Promise.all([
          bill.legislationTypeId
            ? db
                .collection<LegislationType>("legislationTypes")
                .findOne({ _id: bill.legislationTypeId })
            : Promise.resolve(null),
          db
            .collection<StateDemographics>("stateDemographics")
            .find({
              _id: {
                $in: [
                  ...new Set(
                    [...nppMap.values()]
                      .map((n) => n.homeState)
                      .filter((s): s is string => typeof s === "string")
                  ),
                ],
              },
            })
            .toArray(),
          db
            .collection<GameState>("gameState")
            .findOne({ _id: "current" }, { projection: { currentTurn: 1 } }),
        ]);
        const stateDemographicsByState = new Map(stateDemographicsArr.map((row) => [row._id, row]));
        const result = await applyWhipVotesToBill(
          db,
          bill,
          direction,
          nppOfficials,
          nppMap,
          {
            legislationType,
            stateDemographicsByState,
            currentTurn: gameStateDoc?.currentTurn ?? 0,
          },
          mode,
          whipStatecraftBonus
        );
        fellInLine = result.fellInLine;
        ignored = result.ignored;
        if (actorCharacter.stats) await grantStatecraftXp();
      }
    } else if (
      (targetType === "speakerElection" || targetType === "leadershipElection") &&
      candidacyId
    ) {
      const collection =
        targetType === "speakerElection"
          ? "speakerNominations"
          : chamber === "senate"
            ? "senateLeadershipNominations"
            : "houseLeadershipNominations";
      const result = await applyWhipVotesToLeadership(
        db,
        new ObjectId(candidacyId),
        collection,
        nppOfficials,
        nppMap,
        mode,
        whipStatecraftBonus
      );
      fellInLine = result.fellInLine;
      ignored = result.ignored;
      if (actorCharacter.stats) await grantStatecraftXp();
    } else if (targetType === "pmAppointmentVote" || targetType === "noConfidenceVote") {
      const result = await applyWhipVotesToGovernmentVote(
        db,
        requireTargetObjectId(),
        targetType,
        direction,
        nppOfficials,
        nppMap,
        mode,
        whipStatecraftBonus
      );
      fellInLine = result.fellInLine;
      ignored = result.ignored;
      if (actorCharacter.stats) await grantStatecraftXp();
    } else if (targetType === "cabinetNomination") {
      const result = await applyWhipVotesToCabinet(
        db,
        requireTargetObjectId(),
        direction,
        nppOfficials,
        nppMap,
        mode,
        whipStatecraftBonus
      );
      fellInLine = result.fellInLine;
      ignored = result.ignored;
      if (actorCharacter.stats) await grantStatecraftXp();
    } else if (targetType === "speakerVacateMotion") {
      const result = await applyWhipVotesToVacateMotion(
        db,
        direction,
        nppOfficials,
        nppMap,
        mode,
        whipStatecraftBonus
      );
      fellInLine = result.fellInLine;
      ignored = result.ignored;
      if (actorCharacter.stats) await grantStatecraftXp();
    } else if (targetType === "impeachmentVote") {
      const result = await applyWhipVotesToImpeachment(
        db,
        requireTargetObjectId(),
        direction,
        nppOfficials,
        nppMap,
        mode,
        whipStatecraftBonus
      );
      fellInLine = result.fellInLine;
      ignored = result.ignored;
      if (actorCharacter.stats) await grantStatecraftXp();
    }

    const ignoredFlavor = ["defied the whip", "remained unconvinced", "stood their ground"][
      Math.floor(Math.random() * 3)
    ];
    const message =
      targetType === "bill" && mode === "soft"
        ? `Soft caucus whip directive issued (attempt ${attemptNumber}/2). This advisory pressure will feed into future caucus member bill votes.`
        : `Caucus whip directive issued (attempt ${attemptNumber}/2). ${fellInLine} members fell in line. ${ignored} members ${ignoredFlavor}.`;

    return NextResponse.json({
      success: true,
      whipId: insert.insertedId.toString(),
      attemptNumber,
      fellInLine,
      ignored,
      ignoredFlavor,
      message,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
