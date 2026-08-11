/**
 * UK Judicial Review surprise turn — SCOTUS surprise pattern without a full
 * court roster. Proxy lean comes from the ruling party's economic/social
 * positions (cabinet ideology stand-in until a real UKSC exists).
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { onBillEnacted } from "@/lib/billEnactment";
import { createSystemNewsPost } from "@/lib/news";
import type { PolicyProvision } from "@/lib/db/types/legislation";
import type { PoliticalParty } from "@/lib/db/types";
import { rollUkJrSurpriseSpawn } from "@/lib/uk/judicialReview/surpriseSpawn";
import {
  UK_JR_SURPRISE_TEMPLATES,
  type JrCaseEffect,
  type JrCaseAxis,
} from "@/lib/uk/judicialReview/surpriseTemplates";

export interface UkJrSurpriseCaseRecord {
  _id: ObjectId;
  countryId: "UK";
  templateKey: string;
  title: string;
  axis: JrCaseAxis;
  majoritySide: -1 | 0 | 1;
  decidedAtTurn: number;
  createdAt: Date;
}

export interface UkJrSurpriseTurnResult {
  spawned: boolean;
  caseKey?: string;
  majoritySide?: -1 | 0 | 1;
}

/**
 * Resolve proxy court lean from the UK ruling party (or Labour/Con defaults).
 * Negative = left, positive = right — same convention as SCOTUS surprise.
 */
export async function resolveUkProxyCourtLean(db: Db, axis: JrCaseAxis): Promise<-1 | 0 | 1> {
  const formation = await db
    .collection("governmentFormations")
    .findOne(
      { countryId: "UK", status: "formed" },
      { projection: { rulingPartyId: 1, partyId: 1 } }
    );
  const partyId =
    (formation as { rulingPartyId?: string; partyId?: string } | null)?.rulingPartyId ??
    (formation as { rulingPartyId?: string; partyId?: string } | null)?.partyId;

  let economic = 0;
  let social = 0;
  if (partyId) {
    const seq = Number(partyId);
    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne(
        Number.isFinite(seq)
          ? { countryId: "UK", sequentialId: seq }
          : { countryId: "UK", _id: partyId as unknown as ObjectId },
        { projection: { economicPosition: 1, socialPosition: 1 } }
      );
    if (party) {
      economic = party.economicPosition ?? 0;
      social = party.socialPosition ?? 0;
    }
  }

  const lean = axis === "economic" ? economic : social;
  if (lean > 0.5) return 1;
  if (lean < -0.5) return -1;
  return 0;
}

export async function processUkJrSurpriseTurn(
  currentTurn: number,
  db?: Db,
  spawnRandomDraw: number = Math.random(),
  templatePickRandomDraw: number = Math.random()
): Promise<UkJrSurpriseTurnResult> {
  const database = db ?? (await getDb());

  if (!rollUkJrSurpriseSpawn(spawnRandomDraw)) {
    return { spawned: false };
  }

  const usedKeys = new Set(
    (
      await database
        .collection<UkJrSurpriseCaseRecord>("ukJudicialReviewCases")
        .find({ countryId: "UK" }, { projection: { templateKey: 1 } })
        .toArray()
    ).map((c) => c.templateKey)
  );
  const available = UK_JR_SURPRISE_TEMPLATES.filter((t) => !usedKeys.has(t.templateKey));
  if (available.length === 0) {
    return { spawned: false };
  }

  const templateIndex = Math.min(
    available.length - 1,
    Math.floor(templatePickRandomDraw * available.length)
  );
  const template = available[templateIndex];
  const majoritySide = await resolveUkProxyCourtLean(database, template.axis);

  const chosenEffect: JrCaseEffect | undefined =
    majoritySide === 1
      ? template.positiveEffect
      : majoritySide === -1
        ? template.negativeEffect
        : undefined;

  if (chosenEffect) {
    const provision: PolicyProvision = {
      type: "policy",
      legislationTypeId: chosenEffect.legislationTypeId,
      policyOptionId: chosenEffect.policyOptionId,
      effectDirection: chosenEffect.effectDirection,
    };
    const syntheticBillId = new ObjectId();
    await onBillEnacted(
      database,
      {
        _id: syntheticBillId,
        title: `${template.title} (Judicial Review)`,
        legislationTypeId: chosenEffect.legislationTypeId,
        effectDirection: chosenEffect.effectDirection,
        provisions: [provision],
        countryId: "UK",
        stateId: "uk_national",
        source: "uk_judicial_review_surprise",
      },
      currentTurn
    );
  }

  const now = new Date();
  await database.collection<UkJrSurpriseCaseRecord>("ukJudicialReviewCases").insertOne({
    _id: new ObjectId(),
    countryId: "UK",
    templateKey: template.templateKey,
    title: template.title,
    axis: template.axis,
    majoritySide,
    decidedAtTurn: currentTurn,
    createdAt: now,
  });

  try {
    const leanLabel =
      majoritySide === 1 ? "right-leaning" : majoritySide === -1 ? "left-leaning" : "split";
    await createSystemNewsPost(
      `The High Court / UKSC-adjacent bench issued a ${leanLabel} ruling in ${template.title}. The judgment nudges Whitehall policy and will echo through the week's political coverage.`,
      "legislation",
      { title: `Judicial Review: ${template.title}` }
    );
  } catch {
    // Wire is best-effort — never fail the turn on news.
  }

  return { spawned: true, caseKey: template.templateKey, majoritySide };
}
