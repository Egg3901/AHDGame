"use client";

import {
  accountEventProperties,
  getAnalyticsAccount,
  isAnalyticsGenerationCurrent,
  setAnalyticsAccount,
} from "./accountContext";
import { getStoredConsent } from "@/components/CookieConsent";
import { captureAmplitudeEvent, stopAmplitudeCapture } from "./amplitudeClient";
import { capturePostHogEvent, stopPostHogCapture } from "./posthogClient";
import { ACCOUNT_CREATED_KEY, FIRST_MEANINGFUL_ACTION_KEY, FIRST_TURN_KEY } from "./storageKeys";

interface ProductEventContext {
  iteration_id: string;
  turn_number: number;
  nation_id?: string;
}

let productEventContext: ProductEventContext = {
  iteration_id: "unknown",
  turn_number: 0,
};
let productEventContextExpiresAt = 0;
let productEventContextRequest: Promise<ProductEventContext> | null = null;

/** Update the browser's shared game envelope from already loaded game state. */
export function setProductEventContext(
  context: Omit<Partial<ProductEventContext>, "nation_id"> & { nation_id?: string | null }
): void {
  const { nation_id, ...rest } = context;
  productEventContext = { ...productEventContext, ...rest };
  if (nation_id === null) {
    delete productEventContext.nation_id;
  } else if (nation_id !== undefined && /^[A-Z]{2,3}$/.test(nation_id)) {
    productEventContext.nation_id = nation_id;
  } else if (nation_id !== undefined) {
    delete productEventContext.nation_id;
  }
  if (
    typeof context.iteration_id === "string" &&
    typeof context.turn_number === "number" &&
    Number.isInteger(context.turn_number) &&
    context.turn_number >= 0
  ) {
    productEventContextExpiresAt = Date.now() + 15_000;
  }
}

async function getProductEventContext(): Promise<ProductEventContext> {
  if (productEventContextExpiresAt > Date.now()) return productEventContext;
  if (productEventContextRequest) return productEventContextRequest;
  productEventContextRequest = (async () => {
    try {
      const response = await fetch("/api/game/turn/status", { cache: "no-store" });
      if (!response.ok) return productEventContext;
      const status = (await response.json()) as {
        iterationId?: unknown;
        currentTurn?: unknown;
      };
      if (typeof status.iterationId === "string") {
        productEventContext.iteration_id = status.iterationId;
      }
      if (typeof status.currentTurn === "number" && Number.isInteger(status.currentTurn)) {
        productEventContext.turn_number = status.currentTurn;
      }
    } catch {
      // A missing game clock must never block an analytics event or game action.
    }
    productEventContextExpiresAt = Date.now() + 15_000;
    return productEventContext;
  })();
  try {
    return await productEventContextRequest;
  } finally {
    productEventContextRequest = null;
  }
}

/**
 * The single analytics choke point.
 *
 * Every product event goes through here and fans out to both destinations, so
 * instrumentation is written once and no call site knows or cares which tools
 * are live:
 *
 * - **PostHog** — breadth. Session replay, feature flags, experiments, surveys,
 *   error tracking. The daily driver.
 * - **Amplitude** — depth. Retention curves, behavioural cohorts and funnel
 *   decomposition. Opened when there is a hard retention question.
 *
 * Both are consent-gated and neither loads without its own key configured, so
 * this is safe to ship while a destination is still being provisioned. A
 * destination that is not configured resolves to a no-op rather than throwing.
 *
 * Adding a third destination means adding one branch here, not touching the
 * call sites.
 */
export async function captureProductEvent(
  event: string,
  properties?: Record<string, string | number | boolean>
): Promise<void> {
  const identity = getAnalyticsAccount();
  if (!identity.account || getStoredConsent() !== "accepted") return;
  const accountProperties = accountEventProperties(identity.account);
  const context = getStoredConsent() === "accepted" ? await getProductEventContext() : null;
  if (!isAnalyticsGenerationCurrent(identity.generation) || getStoredConsent() !== "accepted")
    return;
  const eventProperties = properties ? { ...properties } : undefined;
  const eventNationId = eventProperties?.nation_id;
  const safeEventNationId =
    typeof eventNationId === "string" && /^[A-Z]{2,3}$/.test(eventNationId)
      ? eventNationId
      : undefined;
  if (eventProperties && eventNationId !== undefined && !safeEventNationId) {
    delete eventProperties.nation_id;
  }
  const suppliedContextIsValid =
    typeof eventProperties?.iteration_id === "string" &&
    /^(?:unknown|(?:alpha|beta|iteration)-[1-9][0-9]*)$/.test(eventProperties.iteration_id) &&
    typeof eventProperties.turn_number === "number" &&
    Number.isInteger(eventProperties.turn_number) &&
    eventProperties.turn_number >= 0;
  const enrichedProperties = context
    ? {
        ...eventProperties,
        ...accountProperties,
        iteration_id: suppliedContextIsValid ? eventProperties!.iteration_id : context.iteration_id,
        turn_number: suppliedContextIsValid ? eventProperties!.turn_number : context.turn_number,
        ...(safeEventNationId
          ? { nation_id: safeEventNationId }
          : context.nation_id
            ? { nation_id: context.nation_id }
            : {}),
      }
    : eventProperties;
  // allSettled, not all: one destination being down or misconfigured must never
  // suppress the other, and analytics must never reject into a caller's flow.
  await Promise.allSettled([
    capturePostHogEvent(event, enrichedProperties),
    captureAmplitudeEvent(event, enrichedProperties),
  ]);
}

/** Withdrawing consent stops every destination, not just the daily driver. */
export async function stopAnalyticsCapture(): Promise<void> {
  setAnalyticsAccount(null);
  await Promise.allSettled([stopPostHogCapture(), stopAmplitudeCapture()]);
}

let accountCaptureInFlight = false;
const characterCaptureInFlight = new Set<string>();
const firstTurnCaptureInFlight = new Set<string>();
const firstMeaningfulActionInFlight = new Set<string>();
const firstMeaningfulActionChecked = new Set<string>();

type FirstMeaningfulActionAnchor = {
  characterId: string;
  createdTurn: number;
  startingNationId?: string;
  creationPath?: string;
  characterCount?: number;
  captured: boolean;
};

function isFirstMeaningfulActionAnchor(value: unknown): value is FirstMeaningfulActionAnchor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.characterId === "string" &&
    typeof record.createdTurn === "number" &&
    typeof record.captured === "boolean"
  );
}

function readFirstMeaningfulActionAnchors(): Record<string, FirstMeaningfulActionAnchor> {
  try {
    const stored = window.localStorage.getItem(FIRST_MEANINGFUL_ACTION_KEY);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (isFirstMeaningfulActionAnchor(parsed)) {
      return { [parsed.characterId]: parsed };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const anchors: Record<string, FirstMeaningfulActionAnchor> = {};
    for (const [characterId, value] of Object.entries(parsed)) {
      if (isFirstMeaningfulActionAnchor(value)) anchors[characterId] = value;
    }
    return anchors;
  } catch {
    return {};
  }
}

/** Carry a successful signup across the mandatory full-page login navigation. */
export function rememberAccountCreated(accountId: string): void {
  if (getStoredConsent() !== "accepted" || typeof accountId !== "string" || !accountId) return;
  try {
    window.localStorage.setItem(ACCOUNT_CREATED_KEY, accountId);
  } catch {
    // Analytics storage is optional.
  }
}

export async function capturePendingAccountCreated(): Promise<void> {
  const { account, generation } = getAnalyticsAccount();
  if (!account) return;
  if (getStoredConsent() !== "accepted" || accountCaptureInFlight) return;
  accountCaptureInFlight = true;
  try {
    const pendingAccount = window.localStorage.getItem(ACCOUNT_CREATED_KEY);
    if (!pendingAccount) return;
    if (pendingAccount !== getAnalyticsAccount().account?.id) {
      window.localStorage.removeItem(ACCOUNT_CREATED_KEY);
      return;
    }
    if (getStoredConsent() !== "accepted") return;
    if (!isAnalyticsGenerationCurrent(generation)) return;
    await captureProductEvent("account_created");
    if (!isAnalyticsGenerationCurrent(generation)) return;
    window.localStorage.removeItem(ACCOUNT_CREATED_KEY);
  } catch {
    // Retry on a later navigation.
  } finally {
    accountCaptureInFlight = false;
  }
}

/** Local anchor for a new character; older characters never enter this funnel. */
export function rememberNewCharacter(
  characterId: string,
  createdTurn: number,
  metadata: { startingNationId?: string; creationPath?: string; characterCount?: number } = {}
): void {
  if (getStoredConsent() !== "accepted" || !Number.isInteger(createdTurn)) return;
  firstMeaningfulActionChecked.delete(characterId);
  try {
    const anchor = { characterId, createdTurn, ...metadata };
    window.localStorage.setItem(
      FIRST_TURN_KEY,
      JSON.stringify({ ...anchor, creationCaptured: false })
    );
    const anchors = readFirstMeaningfulActionAnchors();
    anchors[characterId] = { ...anchor, captured: false };
    window.localStorage.setItem(FIRST_MEANINGFUL_ACTION_KEY, JSON.stringify(anchors));
  } catch {
    // Analytics storage is optional.
  }
}

/** Capture the first successful player action after character creation once. */
export async function captureFirstMeaningfulAction(
  characterId: string,
  action: { action_domain: string; action_type: string }
): Promise<void> {
  const { account, generation } = getAnalyticsAccount();
  if (!account) return;
  if (
    getStoredConsent() !== "accepted" ||
    !characterId ||
    firstMeaningfulActionChecked.has(characterId) ||
    firstMeaningfulActionInFlight.has(characterId)
  )
    return;
  firstMeaningfulActionInFlight.add(characterId);
  try {
    const anchors = readFirstMeaningfulActionAnchors();
    if (anchors[characterId]?.captured) return;
    const response = await fetch("/api/analytics/first-meaningful-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId, consent: true }),
    });
    if (!response.ok || getStoredConsent() !== "accepted") return;
    const result = (await response.json()) as { activation?: Record<string, unknown> | null };
    if (!isAnalyticsGenerationCurrent(generation)) return;
    const activation = result.activation;
    firstMeaningfulActionChecked.add(characterId);
    if (!activation || typeof activation.turns_since_character_creation !== "number") return;
    if (anchors[characterId]) {
      anchors[characterId] = { ...anchors[characterId], captured: true };
      try {
        if (!isAnalyticsGenerationCurrent(generation)) return;
        window.localStorage.setItem(FIRST_MEANINGFUL_ACTION_KEY, JSON.stringify(anchors));
      } catch {
        // The durable claim already owns this event; optional storage cannot suppress it.
      }
    }
    if (!isAnalyticsGenerationCurrent(generation)) return;
    await captureProductEvent("first_meaningful_action", {
      ...action,
      iteration_id:
        typeof activation.iteration_id === "string" ? activation.iteration_id : "unknown",
      turn_number: typeof activation.turn_number === "number" ? activation.turn_number : 0,
      turns_since_character_creation: activation.turns_since_character_creation,
      starting_nation_id:
        typeof activation.starting_nation_id === "string" &&
        /^[A-Z]{2,3}$/.test(activation.starting_nation_id)
          ? activation.starting_nation_id
          : "unknown",
      creation_path:
        activation.creation_path === "character_creator" ? "character_creator" : "unknown",
      character_count:
        typeof activation.character_count === "number" ? activation.character_count : 1,
    });
  } catch {
    // Analytics storage is optional.
  } finally {
    firstMeaningfulActionInFlight.delete(characterId);
  }
}

export async function capturePendingCharacterCreated(characterId: string): Promise<void> {
  const { account, generation } = getAnalyticsAccount();
  if (!account) return;
  if (getStoredConsent() !== "accepted" || characterCaptureInFlight.has(characterId)) return;
  characterCaptureInFlight.add(characterId);
  try {
    const stored = window.localStorage.getItem(FIRST_TURN_KEY);
    if (!stored) return;
    const anchor = JSON.parse(stored) as {
      characterId?: string;
      createdTurn?: number;
      creationCaptured?: boolean;
    };
    if (anchor.characterId !== characterId || anchor.creationCaptured) return;
    if (getStoredConsent() !== "accepted") return;
    if (!isAnalyticsGenerationCurrent(generation)) return;
    await captureProductEvent("character_created");
    if (!isAnalyticsGenerationCurrent(generation)) return;
    window.localStorage.setItem(
      FIRST_TURN_KEY,
      JSON.stringify({ ...anchor, creationCaptured: true })
    );
  } catch {
    // Retry on a later navigation.
  } finally {
    characterCaptureInFlight.delete(characterId);
  }
}

/** A completed world turn after creation is the onboarding funnel's final step. */
export async function captureFirstTurnIfReady(characterId: string): Promise<void> {
  const { account, generation } = getAnalyticsAccount();
  if (!account) return;
  if (getStoredConsent() !== "accepted" || firstTurnCaptureInFlight.has(characterId)) return;
  firstTurnCaptureInFlight.add(characterId);
  let anchor: { characterId: string; createdTurn: number } | null = null;
  try {
    const stored = window.localStorage.getItem(FIRST_TURN_KEY);
    if (stored) anchor = JSON.parse(stored) as { characterId: string; createdTurn: number };
  } catch {
    firstTurnCaptureInFlight.delete(characterId);
    return;
  }
  if (anchor?.characterId !== characterId || !Number.isInteger(anchor.createdTurn)) {
    firstTurnCaptureInFlight.delete(characterId);
    return;
  }

  try {
    const response = await fetch("/api/game/turn/status", { cache: "no-store" });
    if (!response.ok) return;
    const status = (await response.json()) as { currentTurn?: number; isProcessing?: boolean };
    if (
      status.isProcessing ||
      typeof status.currentTurn !== "number" ||
      status.currentTurn <= anchor.createdTurn
    )
      return;
    if (!isAnalyticsGenerationCurrent(generation)) return;
    await capturePendingCharacterCreated(characterId);
    if (getStoredConsent() !== "accepted") return;
    if (!isAnalyticsGenerationCurrent(generation)) return;
    await captureProductEvent("first_turn_completed");
    if (!isAnalyticsGenerationCurrent(generation)) return;
    window.localStorage.removeItem(FIRST_TURN_KEY);
  } catch {
    // A later visit or navigation can retry.
  } finally {
    firstTurnCaptureInFlight.delete(characterId);
  }
}

/** A declaration is a bill first; emit only after the resulting war exists. */
const warDeclarationCaptureInFlight = new Set<string>();

export async function capturePendingWarDeclaration(
  accountId: string,
  force = false
): Promise<void> {
  const { account, generation } = getAnalyticsAccount();
  if (!account || account.id !== accountId) return;
  if (getStoredConsent() !== "accepted" || warDeclarationCaptureInFlight.has(accountId)) return;
  warDeclarationCaptureInFlight.add(accountId);
  try {
    const raw = window.localStorage.getItem("ahd:pending-war-declaration");
    if (!raw) return;
    const pending = JSON.parse(raw) as {
      accountId?: string;
      billId?: string;
      declarer?: string;
      defender?: string;
      lastCheckedAt?: number;
    };
    if (pending.accountId !== accountId || !pending.billId) return;
    if (!force && Date.now() - (pending.lastCheckedAt ?? 0) < 10 * 60 * 1000) return;
    const response = await fetch("/api/world/conflicts", { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json()) as {
      conflicts?: Array<{ declaredByBillId?: string }>;
    };
    if (!payload.conflicts?.some((conflict) => conflict.declaredByBillId === pending.billId)) {
      if (!isAnalyticsGenerationCurrent(generation)) return;
      window.localStorage.setItem(
        "ahd:pending-war-declaration",
        JSON.stringify({ ...pending, lastCheckedAt: Date.now() })
      );
      return;
    }
    if (!isAnalyticsGenerationCurrent(generation)) return;
    await captureProductEvent("war_declared", {
      attacker_nation: pending.declarer ?? "unknown",
      defender_nation: pending.defender ?? "unknown",
    });
    if (!isAnalyticsGenerationCurrent(generation)) return;
    window.localStorage.removeItem("ahd:pending-war-declaration");
  } catch {
    // A later turn can retry.
  } finally {
    warDeclarationCaptureInFlight.delete(accountId);
  }
}
