// src/app/api/parties/[id]/whip/route.ts
import { NextResponse } from "next/server";
import { handleRouteError, forbidden, notFound, badRequest } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { z } from "zod";
import type {
  BillWhip,
  Bill,
  CabinetNomination,
  Character,
  ElectedOfficial,
  GameState,
  LegislationType,
  NPP,
  PlayerWhipMode,
  SpeakerVacateMotion,
  StateDemographics,
} from "@/lib/db/types";
import { getGameTime } from "@/lib/time/gameTime";
import { isLeadershipElectionClosed } from "@/lib/congress/leadershipElections";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
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
} from "@/lib/congress/applyWhipVotes";
import { statecraftWhipBonus } from "@/lib/partyWhips/whipSuccess";
import { USE_GROWTH_INCREMENT } from "@/lib/stats/statsConstants";
import {
  applyPlayerWhipToBill,
  applyPlayerWhipToLeadership,
  applyPlayerWhipToGovernmentVote,
  applyPlayerWhipToCabinet,
  applyPlayerWhipToVacateMotion,
} from "@/lib/congress/applyPlayerWhip";
import { getEligibleCharactersForWhip } from "@/lib/partyWhips/playerWhip";
import { sendSystemMail } from "@/lib/mail/systemMail";
import { createNotification } from "@/lib/notifications";
import type { CountryId } from "@/lib/constants/countries";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import {
  getCabinetWhipChamber,
  getConfidenceWhipChamber,
  isWhippableChamber,
  isCabinetNominationInCountry,
  getChamberLeaderRole,
} from "@/lib/partyWhips/constraints";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import type { Db } from "mongodb";
import { getPartyNppControlStatus } from "@/lib/parties/antiAbuseGuards";
import { recordAudit } from "@/lib/audit/recordAudit";
import { inferWhipIssuerRole } from "@/lib/partyWhips/issuerRole";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
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

// POST /api/country/[code]/parties/[id]/whip — Issue a national party whip directive for a bill or leadership election
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
/**
 * POST /api/parties/[id]/whip
 * Create a whip directive for federal bills or leadership elections
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    // Get authenticated user with character
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const authData = authResult.user;

    const db = await getDb();

    // Get national party
    const party = await findPartyBySequentialId(db, partyId, countryId);

    if (!party) {
      return NextResponse.json(notFound("Party not found").toJson(), { status: 404 });
    }

    const partyIdStr = String(party.sequentialId);

    // Check authorization - Chair, Vice Chair, or chamber leadership
    const characterId = authData.character._id;
    const isChair = party.chairId?.equals(characterId);
    const isViceChair = party.viceChairId?.equals(characterId);
    const isAdmin = authData.isAdmin;
    const parsed = await parseJsonBody(request, whipSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { targetType, targetId, chamber, direction, mode, candidacyId, audience } = parsed.data;

    const chamberLeaderRole = await getChamberLeaderRole(db, characterId, chamber, partyIdStr);
    const issuerRole = chamberLeaderRole ?? inferWhipIssuerRole(isChair, isViceChair);

    if (!isChair && !isViceChair && !isAdmin && !chamberLeaderRole) {
      return NextResponse.json(
        forbidden(
          `Only the ${getPartyRoleLabel(countryId, "chair")}, ${getPartyRoleLabel(countryId, "viceChair")}, or chamber leadership can issue whip directives`
        ).toJson(),
        { status: 403 }
      );
    }

    if (!isWhippableChamber(countryId, chamber)) {
      return NextResponse.json(badRequest("Invalid chamber for this country").toJson(), {
        status: 400,
      });
    }
    if (audience === "npp") {
      const nppControl = await getPartyNppControlStatus({
        db,
        countryId,
        party,
        actor: authData.character,
        isAdmin,
      });
      if (!nppControl.ok) {
        return NextResponse.json(
          forbidden(nppControl.error ?? "NPP controls are locked.").toJson(),
          {
            status: 403,
          }
        );
      }
    }
    const confidenceChamber = getConfidenceWhipChamber(countryId);
    const cabinetChamber = getCabinetWhipChamber(countryId);
    // The motion to vacate is a singleton keyed "current"; pin it server-side so
    // a client cannot address some other document through this target type.
    const normalizedTargetId =
      targetType === "speakerVacateMotion"
        ? "current"
        : countryId === COUNTRY_CONFIGS.US.id &&
            targetType === "speakerElection" &&
            targetId === "speaker"
          ? "current"
          : targetId;
    // Speaker/leadership-election whips route to US-only collections
    // (speakerNominations / houseLeadershipNominations / senateLeadershipNominations)
    // in the apply phase. Reject for German chambers, which use PM
    // appointment / no-confidence votes for executive selection instead.
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

    // Validate target exists and is active
    const targetOid = ObjectId.isValid(normalizedTargetId)
      ? new ObjectId(normalizedTargetId)
      : null;
    const isUSCongressLeadershipTarget =
      countryId === COUNTRY_CONFIGS.US.id &&
      (targetType === "speakerElection" || targetType === "leadershipElection");
    // The vacate motion shares the leadership singleton shape ("current"), so it
    // stores its target id as a string too rather than coercing to an ObjectId.
    const storedTargetId: ObjectId | string =
      isUSCongressLeadershipTarget || targetType === "speakerVacateMotion"
        ? normalizedTargetId
        : (targetOid ?? normalizedTargetId);
    const requireTargetObjectId = (): ObjectId => {
      if (!targetOid) {
        throw badRequest("Invalid target ID");
      }
      return targetOid;
    };

    // Leadership elections reuse a stable _id ("current" for Speaker, the role
    // name for chamber leaders), so old whips from a prior election instance
    // persist in billWhips and count against the new election, freezing the
    // whip panel (ticket #959). Scope the existing-whip checks below to whips
    // issued after the current election opened.
    let whipWindowStart: Date | undefined;

    if (targetType === "bill") {
      if (!targetOid) {
        return NextResponse.json(badRequest("Invalid target ID").toJson(), { status: 400 });
      }
      // Filter bills to the party's country (tolerate legacy bills without countryId)
      const billCountryFilter = { $or: [{ countryId }, { countryId: { $exists: false } }] };
      const bill = await db.collection<Bill>("bills").findOne({
        _id: targetOid,
        status: {
          $in: ["active", "active_other", "active_both", "veto_override", "override_shugiin"],
        },
        ...billCountryFilter,
      });
      if (!bill) {
        return NextResponse.json(notFound("Bill not found or voting not open").toJson(), {
          status: 404,
        });
      }
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
          ? await db.collection("speakerElections").findOne({
              _id: targetOid,
              status: "active",
            })
          : null;
      if (!speakerElection) {
        return NextResponse.json(notFound("Speaker election not found or not active").toJson(), {
          status: 404,
        });
      }
      if (isUSCongressLeadershipTarget) whipWindowStart = speakerElection.startedAt;
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
            .findOne({
              _id: normalizedTargetId,
              status: "voting",
            })
        : targetOid
          ? await db.collection("leadershipElections").findOne({
              _id: targetOid,
              status: "active",
            })
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
    } else if (targetType === "speakerVacateMotion") {
      // US-only: the motion to vacate the chair exists solely for the US House.
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
      // The motion reuses the stable "current" id, so whips from a previous
      // motion would otherwise count against this one's attempt cap (#959).
      whipWindowStart = motion.startedAt;
    } else if (targetType === "pmAppointmentVote") {
      if (!targetOid) {
        return NextResponse.json(badRequest("Invalid target ID").toJson(), { status: 400 });
      }
      const pmVotesColl = getPMAppointmentVotesCollection(db);
      const pmVote = await pmVotesColl.findOne({ _id: targetOid, status: "active" });
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
      const ncVotesColl = getNoConfidenceVotesCollection(db);
      const ncVote = await ncVotesColl.findOne({ _id: targetOid, status: "active" });
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
    } else if (targetType === "cabinetNomination") {
      if (!targetOid) {
        return NextResponse.json(badRequest("Invalid target ID").toJson(), { status: 400 });
      }
      const nomination = await db.collection("cabinetNominations").findOne<CabinetNomination>({
        _id: targetOid,
        status: "active",
      });
      if (!nomination) {
        return NextResponse.json(notFound("Cabinet nomination not found or not active").toJson(), {
          status: 404,
        });
      }
      if (!isCabinetNominationInCountry(nomination, countryId)) {
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

    // Check existing whips (max 2 per target/chamber for national party NPP whips).
    // Legacy docs without `audience` are treated as "npp" so they still count.
    const existingWhips = await db
      .collection<BillWhip>("billWhips")
      .find({
        targetType,
        targetId: storedTargetId,
        chamber,
        partyId: partyIdStr,
        issuedBy: "nationalParty",
        $or: [{ audience: "npp" }, { audience: { $exists: false } }],
        ...(whipWindowStart ? { createdAt: { $gte: whipWindowStart } } : {}),
      })
      .toArray();

    if (audience === "npp" && existingWhips.length >= 2) {
      return NextResponse.json(
        badRequest("Maximum 2 whip attempts per bill/chamber reached").toJson(),
        { status: 400 }
      );
    }

    // ── Character (player) audience branch ───────────────────────────────────
    if (audience === "character") {
      const existingCharacterWhips = await db
        .collection<BillWhip>("billWhips")
        .find({
          targetType,
          targetId: storedTargetId,
          chamber,
          partyId: partyIdStr,
          issuedBy: "nationalParty",
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

      const eligible = await getEligibleCharactersForWhip(db, countryId, partyIdStr, chamber);

      // Insert audit row first so failures in the apply step leave a trace
      const pwNow = new Date();
      const playerWhipDoc: Omit<BillWhip, "_id"> = {
        targetType,
        targetId: storedTargetId,
        chamber,
        direction,
        candidacyId: candidacyId ? new ObjectId(candidacyId) : undefined,
        issuedBy: "nationalParty",
        countryId,
        partyId: partyIdStr,
        issuedByCharacterId: characterId,
        issuedByRole: issuerRole,
        audience: "character",
        mode,
        attemptNumber: 1,
        createdAt: pwNow,
        updatedAt: pwNow,
      };
      const pwInsert = await db
        .collection<BillWhip>("billWhips")
        .insertOne(playerWhipDoc as BillWhip);

      recordAudit({
        source: "api",
        action: "party.whip",
        category: "party",
        actor: { kind: "player", userId: undefined, characterId, name: authData.character.name },
        subject: { type: playerWhipDoc.targetType, id: playerWhipDoc.targetId },
        counterparty: { type: "party", id: partyIdStr, name: party.name },
        refs: { partyId: partyIdStr },
        outcome: "ok",
        meta: {
          billWhipId: pwInsert.insertedId,
          chamber,
          direction,
          mode,
          audience: "character",
          issuerRole,
        },
      });

      let overridden = 0;
      let alreadyAligned = 0;

      if (mode === "hard") {
        if (targetType === "bill") {
          const bill = await db
            .collection<Bill>("bills")
            .findOne({ _id: requireTargetObjectId(), countryId });
          if (bill) {
            const r = await applyPlayerWhipToBill(db, bill, direction, eligible);
            overridden = r.overridden;
            alreadyAligned = r.alreadyAligned;
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
          const r = await applyPlayerWhipToLeadership(
            db,
            new ObjectId(candidacyId),
            collectionName,
            eligible
          );
          overridden = r.overridden;
          alreadyAligned = r.alreadyAligned;
        } else if (targetType === "pmAppointmentVote" || targetType === "noConfidenceVote") {
          const r = await applyPlayerWhipToGovernmentVote(
            db,
            requireTargetObjectId(),
            targetType,
            direction,
            eligible
          );
          overridden = r.overridden;
          alreadyAligned = r.alreadyAligned;
        } else if (targetType === "cabinetNomination") {
          const r = await applyPlayerWhipToCabinet(
            db,
            requireTargetObjectId(),
            direction,
            eligible
          );
          overridden = r.overridden;
          alreadyAligned = r.alreadyAligned;
        } else if (targetType === "speakerVacateMotion") {
          const r = await applyPlayerWhipToVacateMotion(db, direction, eligible);
          overridden = r.overridden;
          alreadyAligned = r.alreadyAligned;
        }
      }

      const { subject, body, notificationTitle } = await buildPlayerWhipMessage(
        db,
        targetType,
        storedTargetId,
        direction,
        mode,
        candidacyId ? new ObjectId(candidacyId) : undefined
      );

      const charDocs =
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
      for (const char of charDocs) {
        try {
          if (mode === "hard") {
            await sendSystemMail(db, {
              toCharacterId: char._id,
              toCharacterName: char.name,
              toCharacterSequentialId: char.sequentialId ?? 0,
              toUserId: char.userId,
              subject,
              body,
              senderName: "Party Whip",
            });
          }
          await createNotification({
            userId: char.userId,
            type: "party_whip_issued",
            title: notificationTitle,
            message: subject,
            metadata: {
              targetType,
              targetId:
                typeof storedTargetId === "string" ? storedTargetId : storedTargetId.toString(),
              direction,
              mode,
            },
          });
          mailedCount++;
        } catch (err) {
          console.warn("[player-whip] Failed to notify character", String(char._id), err);
        }
      }

      return NextResponse.json({
        success: true,
        whipId: pwInsert.insertedId.toString(),
        audience: "character",
        mode,
        affected: overridden,
        alreadyAligned,
        mailedCount,
        message:
          mode === "soft"
            ? `Soft Player Whip issued. ${mailedCount} players notified.`
            : `Hard Player Whip issued. ${overridden} players overridden, ${alreadyAligned} already aligned, ${mailedCount} notified.`,
      });
    }

    const attemptNumber = (existingWhips.length + 1) as 1 | 2;

    // Create whip
    const now = new Date();
    const whipDoc: Omit<BillWhip, "_id"> = {
      targetType,
      targetId: storedTargetId,
      chamber,
      direction,
      mode,
      candidacyId: candidacyId ? new ObjectId(candidacyId) : undefined,
      issuedBy: "nationalParty",
      countryId,
      partyId: partyIdStr,
      issuedByCharacterId: characterId,
      issuedByRole: issuerRole,
      audience: "npp",
      attemptNumber,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection<BillWhip>("billWhips").insertOne(whipDoc as BillWhip);

    recordAudit({
      source: "api",
      action: "party.whip",
      category: "party",
      actor: { kind: "player", userId: undefined, characterId, name: authData.character.name },
      subject: { type: whipDoc.targetType, id: whipDoc.targetId },
      counterparty: { type: "party", id: partyIdStr, name: party.name },
      refs: { partyId: partyIdStr },
      outcome: "ok",
      meta: {
        billWhipId: result.insertedId,
        chamber,
        direction,
        mode,
        audience: "npp",
        issuerRole,
      },
    });

    // Fetch party NPPs in this chamber and cast their votes immediately
    const nppOfficials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        isNPP: true,
        // Country-scope the officials: party sequentialIds collide across
        // countries (US "3" = Reform, BR "3" = a Brazilian party), so without
        // this filter a whip would also fetch and vote foreign senators of the
        // same numeric party onto a domestic bill (bug #0699).
        countryId,
        party: partyIdStr,
        // Resolve the chamber key to the office type members are stored under
        // (CN: "npc" key → "npcDelegate" office), else zero CN delegates match
        // and the whip falls on nobody.
        officeType: getOfficeTypeForChamber(countryId, chamber),
      })
      .toArray();

    const nppIds = nppOfficials.map((o) => o.nppId).filter((id): id is ObjectId => !!id);

    const npps =
      nppIds.length > 0
        ? await db
            .collection<NPP>("npps")
            .find({ _id: { $in: nppIds } })
            .toArray()
        : [];

    const nppMap = new Map(npps.map((n) => [n._id.toString(), n]));

    let fellInLine = 0;
    let ignored = 0;

    // Statecraft sharpens a chair's whip: higher stat → more NPPs fall in line.
    // Use-growth: whipping trains Statecraft (flushed each turn). Both apply
    // across every NPP whip target (bill, leadership, government, cabinet).
    const whipStatecraftBonus = statecraftWhipBonus(authData.character.stats?.statecraft);
    const grantStatecraftXp = async () => {
      await db
        .collection("characters")
        .updateOne({ _id: characterId }, { $inc: { "statXp.statecraft": USE_GROWTH_INCREMENT } });
    };

    if (targetType === "bill") {
      const bill = await db
        .collection<Bill>("bills")
        .findOne({ _id: requireTargetObjectId(), countryId });
      if (bill) {
        // Phase 4: applyWhipVotesToBill resolves NPP votes via cross-pressure,
        // which needs the bill's legislation type, the home-state demographics
        // for each NPP, and the current turn for the prediction snapshot.
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
        const stateDemographicsByState = new Map(stateDemographicsArr.map((s) => [s._id, s]));
        const r = await applyWhipVotesToBill(
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
        fellInLine = r.fellInLine;
        ignored = r.ignored;
        if (authData.character.stats) await grantStatecraftXp();
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
      const r = await applyWhipVotesToLeadership(
        db,
        new ObjectId(candidacyId),
        collection,
        nppOfficials,
        nppMap,
        mode,
        whipStatecraftBonus
      );
      fellInLine = r.fellInLine;
      ignored = r.ignored;
      if (authData.character.stats) await grantStatecraftXp();
    } else if (targetType === "pmAppointmentVote" || targetType === "noConfidenceVote") {
      const r = await applyWhipVotesToGovernmentVote(
        db,
        requireTargetObjectId(),
        targetType,
        direction,
        nppOfficials,
        nppMap,
        mode,
        whipStatecraftBonus
      );
      fellInLine = r.fellInLine;
      ignored = r.ignored;
      if (authData.character.stats) await grantStatecraftXp();
    } else if (targetType === "cabinetNomination") {
      const r = await applyWhipVotesToCabinet(
        db,
        requireTargetObjectId(),
        direction,
        nppOfficials,
        nppMap,
        mode,
        whipStatecraftBonus
      );
      fellInLine = r.fellInLine;
      ignored = r.ignored;
      if (authData.character.stats) await grantStatecraftXp();
    } else if (targetType === "speakerVacateMotion") {
      const r = await applyWhipVotesToVacateMotion(
        db,
        direction,
        nppOfficials,
        nppMap,
        mode,
        whipStatecraftBonus
      );
      fellInLine = r.fellInLine;
      ignored = r.ignored;
      if (authData.character.stats) await grantStatecraftXp();
    }

    const ignoredFlavor = ["defied the whip", "remained unconvinced", "stood their ground"][
      Math.floor(Math.random() * 3)
    ];
    const message =
      targetType === "bill" && mode === "soft"
        ? `Soft whip directive issued (attempt ${attemptNumber}/2). This advisory pressure will feed into future NPP bill votes.`
        : `Whip directive issued (attempt ${attemptNumber}/2). ${fellInLine} NPPs fell in line. ${ignored} NPPs ${ignoredFlavor}.`;

    return NextResponse.json({
      success: true,
      whipId: result.insertedId.toString(),
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

/**
 * Build mail subject + body for a Player Whip notification based on target type.
 * Used by the character-audience branch to tell each whipped player what to do.
 */
async function buildPlayerWhipMessage(
  db: Db,
  targetType: string,
  targetId: ObjectId | string,
  direction: "for" | "against",
  mode: PlayerWhipMode,
  _candidacyId?: ObjectId
): Promise<{ subject: string; body: string; notificationTitle: string }> {
  const dir = direction === "for" ? "AYE" : "NAY";
  const isSoft = mode === "soft";
  const notificationTitle = isSoft ? "Party vote recommendation" : "You have been whipped";
  if (targetType === "bill") {
    if (!(targetId instanceof ObjectId)) {
      return {
        subject: isSoft
          ? `Party suggestion: Vote ${dir} on a bill`
          : `Party Whip: Vote ${dir} on a bill`,
        body: isSoft
          ? `Your national party suggests that you vote ${dir} on a bill. Review the bill page if you want to follow the recommendation.`
          : `Your national party has whipped you to vote ${dir} on a bill. You may change your vote at any time by visiting the bill's voting page.`,
        notificationTitle,
      };
    }
    const bill = await db
      .collection<Bill>("bills")
      .findOne({ _id: targetId }, { projection: { title: 1 } });
    const title = bill?.title ?? "a bill";
    return {
      subject: isSoft
        ? `Party suggestion: Vote ${dir} on "${title}"`
        : `Party Whip: Vote ${dir} on "${title}"`,
      body: isSoft
        ? `Your national party suggests that you vote ${dir} on "${title}". Review the bill page if you want to follow the recommendation.`
        : `Your national party has whipped you to vote ${dir} on "${title}". You may change your vote at any time by visiting the bill's voting page.`,
      notificationTitle,
    };
  }
  if (targetType === "pmAppointmentVote") {
    return {
      subject: isSoft
        ? `Party suggestion: Vote ${dir} on PM appointment`
        : `Party Whip: Vote ${dir} on PM appointment`,
      body: isSoft
        ? `Your national party suggests that you vote ${dir} on the PM appointment vote.`
        : `Your national party has whipped you to vote ${dir} on the PM appointment vote. You may change your vote at any time.`,
      notificationTitle,
    };
  }
  if (targetType === "noConfidenceVote") {
    return {
      subject: isSoft
        ? `Party suggestion: Vote ${dir} on no-confidence motion`
        : `Party Whip: Vote ${dir} on no-confidence motion`,
      body: isSoft
        ? `Your national party suggests that you vote ${dir} on the no-confidence motion.`
        : `Your national party has whipped you to vote ${dir} on the no-confidence motion. You may change your vote at any time.`,
      notificationTitle,
    };
  }
  if (targetType === "speakerVacateMotion") {
    // Name the action rather than the ballot value: "AYE" on a motion to vacate
    // reads as ambiguous, whereas vacating or keeping the chair does not.
    const action = direction === "for" ? "vacate the chair" : "keep the Speaker";
    return {
      subject: isSoft ? `Party suggestion: Vote to ${action}` : `Party Whip: Vote to ${action}`,
      body: isSoft
        ? `Your national party suggests that you vote to ${action} on the motion to vacate.`
        : `Your national party has whipped you to vote to ${action} on the motion to vacate. You may change your vote at any time.`,
      notificationTitle,
    };
  }
  if (targetType === "cabinetNomination") {
    return {
      subject: isSoft
        ? `Party suggestion: Vote ${dir} on cabinet nomination`
        : `Party Whip: Vote ${dir} on cabinet nomination`,
      body: isSoft
        ? `Your national party suggests that you vote ${dir} on the cabinet nomination.`
        : `Your national party has whipped you to vote ${dir} on the cabinet nomination. You may change your vote at any time.`,
      notificationTitle,
    };
  }
  return {
    subject: isSoft
      ? `Party suggestion: Support assigned candidate`
      : `Party Whip: Support assigned candidate`,
    body: isSoft
      ? `Your national party suggests that you support the assigned candidate in a leadership election.`
      : `Your national party has whipped you to vote for the assigned candidate in a leadership election. You may change your vote at any time.`,
    notificationTitle,
  };
}
