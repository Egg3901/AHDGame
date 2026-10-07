"use client";

import { getAnalyticsAccount, isAnalyticsGenerationCurrent } from "./accountContext";
import { getStoredConsent } from "@/components/CookieConsent";
import { captureFirstMeaningfulAction, captureProductEvent } from "./capture";

const PLAYER_ACTION_API_ROOTS = new Set([
  "actions",
  "banking",
  "bonds",
  "br",
  "campaigns",
  "canvassing",
  "character",
  "characters",
  "charters",
  "commodities",
  "contracts",
  "congress",
  "congressional-districts",
  "corporation",
  "corporations",
  "country",
  "cn",
  "crises",
  "de",
  "debates",
  "elections",
  "events",
  "forex",
  "governors",
  "imf",
  "impeachments",
  "ie",
  "index-funds",
  "index-petitions",
  "intorg",
  "jp",
  "investment-funds",
  "merger-reviews",
  "npps",
  "news",
  "ng",
  "onboarding",
  "officials",
  "parties",
  "pip",
  "portfolio",
  "player-ads",
  "political-operations",
  "politician",
  "politician-overrides",
  "prospecting",
  "ru",
  "sectors",
  "settings",
  "state",
  "states",
  "stock-exchange",
  "subsidies",
  "targeted-ads",
  "tariffs",
  "uk",
  "unions",
  "vacancies",
  "whitehouse",
  "world",
]);

const ACTION_VERBS = new Set([
  "accept",
  "add",
  "appoint",
  "approve",
  "attack",
  "build",
  "buy",
  "campaign",
  "cancel",
  "cast",
  "close",
  "cosponsor",
  "uncosponsor",
  "filibuster",
  "veto_override_vote",
  "presidential_action",
  "create",
  "declare",
  "defend",
  "delete",
  "deposit",
  "donate",
  "endorse",
  "enter",
  "execute",
  "expand",
  "file",
  "fire",
  "invest",
  "join",
  "leave",
  "merge",
  "negotiate",
  "open",
  "place",
  "propose",
  "purchase",
  "raise",
  "remove",
  "repay",
  "resign",
  "retire",
  "sell",
  "send",
  "sign",
  "subscribe",
  "surge",
  "target",
  "train",
  "transfer",
  "travel",
  "upgrade",
  "update",
  "vote",
  "withdraw",
  "wire",
]);

// Route vocabulary is fixed here: arbitrary slugs, option text and request
// content never become event properties.
const DEPTH_ACTION_SEGMENTS = new Set([
  "auto-join",
  "abandon",
  "agenda",
  "approval",
  "assign",
  "assign-branch",
  "back",
  "bid",
  "blacklist",
  "build",
  "bulk",
  "bulk-org",
  "campaigners",
  "capacity",
  "capital-injection",
  "caretaker",
  "cash",
  "caucuses",
  "challenge",
  "charter",
  "consolidate",
  "decision",
  "defence-contracts",
  "detente",
  "discount-window",
  "discussion",
  "dissolve",
  "dividend-floor",
  "dividends",
  "draw-cap",
  "embargoes",
  "escrow-withdraw",
  "escalate",
  "exchange",
  "factories",
  "fill",
  "formalize",
  "fund-direction",
  "go-public",
  "gotv",
  "growth",
  "hero",
  "hostile-takeover",
  "index-petition",
  "influence",
  "interact",
  "issue",
  "join-requests",
  "landesliste",
  "legal-structure",
  "lending-profile",
  "list",
  "listings",
  "lobby",
  "loans",
  "mandate",
  "margin",
  "members",
  "motions",
  "name",
  "nominate",
  "offers",
  "orders",
  "parent-bond-payoff",
  "platform",
  "play",
  "policy",
  "positions",
  "posture",
  "pricing",
  "priority-region",
  "private-invites",
  "privatize",
  "profit-split",
  "proposals",
  "ps-investment",
  "purge",
  "rate",
  "rates",
  "recapitalize",
  "recruit",
  "refinance",
  "registration-drive",
  "release",
  "relocate",
  "remove-ceo",
  "rename",
  "request",
  "restructure",
  "resign-ceo",
  "ruleset",
  "schedule",
  "sectors",
  "self-issue",
  "settings",
  "shareholder-address",
  "slate",
  "spin-off",
  "stockpile",
  "strategy",
  "subsidiary",
  "supply-agreements",
  "supply-listings",
  "suppression",
  "tariffs",
  "tax",
  "terms",
  "ticker",
  "treasury-draw",
  "treasury-plan",
  "union-busting",
  "unlist",
  "unlock",
  "upstream",
  "wage",
  "whip",
]);

type DepthFamily = "party" | "corporation" | "market" | "battle" | "diplomacy" | "crisis";

function depthFamilyFor(segments: string[]): DepthFamily | undefined {
  if (segments.includes("crises") || segments.includes("crisis")) return "crisis";
  if (segments.includes("parties") || segments.includes("party")) return "party";
  if (
    segments.some((segment) =>
      ["battle", "battles", "combat", "offensive", "offensives"].includes(segment)
    )
  )
    return "battle";
  if (
    segments.some((segment) =>
      [
        "forex",
        "commodities",
        "shares",
        "bonds",
        "stock-exchange",
        "index-funds",
        "investment-funds",
      ].includes(segment)
    )
  )
    return "market";
  if (
    segments.some((segment) =>
      ["corporation", "corporations", "national-corporation"].includes(segment)
    )
  )
    return "corporation";
  if (
    segments.some((segment) =>
      [
        "world",
        "intorg",
        "imf",
        "diplomacy",
        "diplomatic",
        "foreign-affairs",
        "treaties",
        "treaty",
        "relations",
        "trade",
        "conflicts",
        "conflict",
        "peace",
      ].includes(segment)
    )
  )
    return "diplomacy";
  return undefined;
}

const ELECTION_TYPES = new Set([
  "president",
  "presidential",
  "house",
  "senate",
  "stateSenate",
  "governor",
  "special_governor",
  "commons",
  "snap_commons",
  "special_commons",
  "primeMinister",
  "holyrood",
  "senedd",
  "regionalCouncil",
  "shugiin",
  "sangiin",
  "bundestag",
  "snap_bundestag",
  "assembleeNationale",
  "cameraDeputati",
  "chamber",
  "congresoDiputados",
  "dail",
  "landAssembly",
  "landtag",
  "localCouncil",
  "milletMeclisi",
  "nationalitiesDeputy",
  "npcDelegate",
  "peoplesCongress",
  "republicSupremeSoviet",
  "riksdag",
  "seanad",
  "senat",
  "senato",
  "specialElection",
  "supremeSoviet",
  "supremeSovietDeputy",
  "uachtaran",
  "volkskammerDeputy",
  "presidential_primary",
  "party_leadership",
]);

const ACTION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const NON_ACTION_PATH_SEGMENTS = new Set([
  "check",
  "forecast",
  "simulate",
  "dry-run",
  "lookup",
  "preview",
  "query",
  "results",
  "search",
  "summary",
  "validate",
]);
const OBJECT_ID = /^[a-f\d]{24}$/i;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const REGION_ID = /^[A-Za-z0-9_-]{1,32}$/;
const NATION_ID = /^[A-Z]{2,3}$/;

export interface PlayerActionContext {
  userId: string | null;
  characterId: string | null;
  nationId?: string | null;
  partyId?: string | null;
  characterCount?: number | null;
  creationPath?: string | null;
  isPrivileged?: boolean;
}

export interface PlayerActionRoute {
  pathname: string;
  method: string;
  action_domain: string;
  action_type: string;
  scope: string;
  entity_type: string;
  entity_id?: string;
  nation_id?: string;
  election?: {
    election_id: string;
    action_type: string;
    phase: string;
  };
  depth_family?: DepthFamily;
  campaign?: {
    campaign_id: string;
  };
}

let actionContext: PlayerActionContext = { userId: null, characterId: null };
let installedFetch: typeof window.fetch | null = null;
let originalFetch: typeof window.fetch | null = null;

export function setPlayerActionContext(context: PlayerActionContext): void {
  actionContext = context;
}

function normalizedMethod(method: string): string {
  return method.toUpperCase();
}

function getSegments(pathname: string): string[] {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
}

function entityIdFromPath(pathname: string): string | undefined {
  return pathname.split("/").find((segment) => OBJECT_ID.test(segment) || UUID.test(segment));
}

function actionTypeFor(segments: string[], method: string): string {
  const action = [...segments].reverse().find((segment) => ACTION_VERBS.has(segment));
  if (action) return action;
  const depthAction = [...segments].reverse().find((segment) => DEPTH_ACTION_SEGMENTS.has(segment));
  if (depthAction) return depthAction.replaceAll("-", "_");
  if (segments.includes("home-state-surge")) return "home_state_surge";
  if (segments.includes("state-attack")) return "state_attack";
  if (segments.includes("campaigns") || segments.includes("campaign")) return "campaign";
  if (segments.includes("primary-campaign")) return "primary_campaign";
  if (segments.includes("state-operations")) return "state_operations";
  if (segments.includes("running-mate")) return "running_mate";
  if (segments.includes("endorse")) return "endorse";
  return method.toLowerCase();
}

function actionDomainFor(segments: string[]): string {
  const root = segments[1] ?? "";
  if (segments.includes("crises")) return "crisis";
  if (
    segments.some((segment) =>
      ["battle", "battles", "combat", "offensive", "offensives", "military"].includes(segment)
    )
  )
    return "military";
  if (root === "elections" || root === "campaigns" || root === "canvassing") return "election";
  if (root === "congress" || root === "impeachments" || root === "whitehouse") return "legislation";
  if (root === "bonds" || root === "banking" || root === "forex" || root === "portfolio")
    return "finance";
  if (
    [
      "commodities",
      "corporation",
      "corporations",
      "index-funds",
      "investment-funds",
      "sectors",
      "stock-exchange",
      "subsidies",
      "tariffs",
    ].includes(root)
  )
    return "economy";
  if (["world", "intorg", "imf"].includes(root)) return "diplomacy";
  if (["player-ads", "political-operations", "politician"].includes(root)) return "politics";
  if (root === "character" || root === "characters") return "character";
  if (root === "news") return "media";
  if (root === "onboarding") return "onboarding";
  if (
    segments.includes("military") ||
    segments.includes("conflict") ||
    segments.includes("conflicts") ||
    segments.includes("battle")
  )
    return "military";
  if (segments.includes("legislature") || segments.includes("bill") || segments.includes("bills"))
    return "legislation";
  if (segments.includes("election") || segments.includes("elections")) return "election";
  if (segments.includes("executive") || segments.includes("cabinet")) return "government";
  if (segments.includes("parties") || segments.includes("party")) return "politics";
  if (segments.includes("national-corporation")) return "economy";
  if (["country", "uk"].includes(root)) return "government";
  if (["state", "states", "governors", "officials", "npps"].includes(root)) return "government";
  if (["campaigns", "charters", "debates", "events", "parties", "unions"].includes(root))
    return "politics";
  return "government";
}

function entityTypeFor(segments: string[], domain: string): string {
  const known = [
    "election",
    "bill",
    "corporation",
    "bond",
    "party",
    "character",
    "state",
    "region",
    "country",
    "conflict",
    "campaign",
    "fund",
    "office",
    "crisis",
    "battle",
    "order",
    "listing",
    "commodity",
    "treaty",
  ];
  if (segments.includes("crises")) return "crisis";
  const singular = (segment: string) =>
    segment === "parties"
      ? "party"
      : segment === "commodities"
        ? "commodity"
        : segment.replace(/s$/, "");
  const entity = [...segments]
    .reverse()
    .map(singular)
    .find((segment) => known.includes(segment));
  if (entity) return entity;
  if (domain === "election") return "election";
  if (domain === "legislation") return "bill";
  if (domain === "finance") return "account";
  if (domain === "economy") return "corporation";
  if (domain === "military") return "conflict";
  return "government";
}

function scopeFor(segments: string[], root: string): string {
  if (segments.includes("region") || segments.includes("state") || segments.includes("district"))
    return "regional";
  if (root === "world" || root === "intorg" || root === "imf" || segments.includes("conflicts"))
    return "world";
  if (root === "country" || ["uk", "de", "ie", "jp", "ng", "cn", "ru", "br"].includes(root))
    return "nation";
  return "entity";
}

export function classifyPlayerActionRoute(
  pathname: string,
  methodInput: string
): PlayerActionRoute | null {
  const method = normalizedMethod(methodInput);
  const segments = getSegments(pathname);
  if (!pathname.startsWith("/api/") || !ACTION_METHODS.has(method)) return null;
  const root = segments[1] ?? "";
  if (!PLAYER_ACTION_API_ROOTS.has(root)) return null;
  if (segments.some((segment) => ["admin", "bot", "public"].includes(segment))) return null;
  if (
    root === "settings" &&
    !segments.some((segment) => ["resign", "resign-all"].includes(segment))
  )
    return null;
  if (segments.some((segment) => NON_ACTION_PATH_SEGMENTS.has(segment))) return null;
  const action_domain = actionDomainFor(segments);
  const action_type = actionTypeFor(segments, method);
  const entity_type = entityTypeFor(segments, action_domain);
  const partyIndex = segments.findIndex((segment) => segment === "parties" || segment === "party");
  const partyId = partyIndex >= 0 ? pathname.split("/")[partyIndex + 2] : undefined;
  const rawSegments = pathname.split("/").filter(Boolean);
  const entityIndex = segments.reduce(
    (index, segment, current) =>
      segment === entity_type ||
      segment === `${entity_type}s` ||
      (entity_type === "party" && segment === "parties")
        ? current
        : index,
    -1
  );
  const entityPathId = rawSegments[entityIndex + 1];
  const id =
    (entityIndex >= 0 && entityPathId && (OBJECT_ID.test(entityPathId) || UUID.test(entityPathId))
      ? entityPathId
      : undefined) ??
    (entityIndex < 0 ? entityIdFromPath(pathname) : undefined) ??
    (entity_type === "party" && partyId && /^\d{1,10}$/.test(partyId) ? partyId : undefined);
  const depth_family = depthFamilyFor(segments);
  const nation = root === "country" ? segments[2]?.toUpperCase() : root.toUpperCase();
  const nation_id = nation && NATION_ID.test(nation) ? nation : undefined;
  const campaignId = root === "campaigns" ? segments[2] : undefined;
  const electionSegment = segments.indexOf("elections");
  const electionId = electionSegment >= 0 ? pathname.split("/")[electionSegment + 2] : undefined;
  const electionAction = electionSegment >= 0 ? segments[electionSegment + 2] : undefined;
  const electionActionType =
    electionAction === "campaigns"
      ? "campaign"
      : electionAction === "primary-campaign"
        ? "primary_campaign"
        : electionAction === "home-state-surge"
          ? "home_state_surge"
          : electionAction === "state-attack"
            ? "state_attack"
            : electionAction === "state-operations"
              ? "state_operations"
              : electionAction === "running-mate"
                ? "running_mate"
                : electionAction;
  const election =
    electionId &&
    (OBJECT_ID.test(electionId) || UUID.test(electionId)) &&
    [
      "enter",
      "campaigns",
      "primary-campaign",
      "home-state-surge",
      "state-attack",
      "travel",
      "state-operations",
      "endorse",
      "withdraw",
      "running-mate",
    ].includes(electionAction ?? "")
      ? {
          election_id: electionId,
          action_type:
            electionAction === "running-mate" && segments.includes("travel")
              ? "running_mate_travel"
              : (electionActionType ?? "action"),
          phase:
            ["enter", "primary-campaign", "home-state-surge", "state-attack"].includes(
              electionAction ?? ""
            ) || segments.includes("primary")
              ? "primary"
              : ["travel", "campaigns"].includes(electionAction ?? "")
                ? "general"
                : "unknown",
        }
      : undefined;

  return {
    pathname,
    method,
    action_domain,
    action_type,
    scope: scopeFor(segments, root),
    entity_type,
    ...(depth_family ? { depth_family } : {}),
    ...(id ? { entity_id: id } : {}),
    ...(nation_id ? { nation_id } : {}),
    ...(election ? { election } : {}),
    ...(campaignId && OBJECT_ID.test(campaignId) ? { campaign: { campaign_id: campaignId } } : {}),
  };
}

function parseJsonBody(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function readRequestBody(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Record<string, unknown> | null> {
  if (typeof init?.body === "string") return parseJsonBody(init.body);
  if (typeof Request !== "undefined" && input instanceof Request) {
    try {
      return await input.clone().json();
    } catch {
      return null;
    }
  }
  return null;
}

function safeRegionId(body: Record<string, unknown> | null): string | undefined {
  if (!body) return undefined;
  for (const key of [
    "targetRegionId",
    "regionId",
    "stateId",
    "homeState",
    "travelState",
    "primaryCampaignState",
    "state",
  ]) {
    const value = body[key];
    if (typeof value === "string" && REGION_ID.test(value)) return value;
  }
  return undefined;
}

function safeSpend(
  body: Record<string, unknown> | null,
  source: "request" | "response" = "request"
): { resource_type: string; resource_amount: number } | undefined {
  if (!body) return undefined;
  const keys: Array<[string, string]> = [
    ["fundsSpent", "funds"],
    ["fundsCost", "funds"],
    ["cost", "funds"],
    ["funds", "funds"],
    ["politicalInfluenceCost", "political_influence"],
    ["influenceCost", "political_influence"],
    ["actionCost", "actions"],
    ["actionsCost", "actions"],
    ["actionPoints", "actions"],
    ["favorabilityCost", "favorability"],
    ["shares", "shares"],
    ["units", "units"],
    ["quantity", "quantity"],
    ["amount", "funds"],
  ];
  for (const [key, resource_type] of keys) {
    if (
      source === "response" &&
      ["funds", "actionPoints", "shares", "units", "quantity", "amount"].includes(key)
    )
      continue;
    const amount = body[key];
    if (typeof amount === "number" && Number.isFinite(amount) && amount >= 0) {
      return { resource_type, resource_amount: amount };
    }
  }
  return undefined;
}

function failureCode(status: number): string {
  if (status === 400 || status === 422) return "validation_failed";
  if (status === 401) return "authentication_required";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "request_failed";
}

function safeElectionType(responseBody: Record<string, unknown> | null): string {
  const nested = responseBody?.election;
  const value =
    typeof responseBody?.electionType === "string"
      ? responseBody.electionType
      : nested && typeof nested === "object" && "electionType" in nested
        ? (nested as { electionType?: unknown }).electionType
        : undefined;
  return typeof value === "string" && ELECTION_TYPES.has(value) ? value : "unknown";
}

function safeElectionPhase(responseBody: Record<string, unknown> | null): string | undefined {
  const nested = responseBody?.election;
  const value =
    typeof responseBody?.phase === "string"
      ? responseBody.phase
      : nested && typeof nested === "object" && "phase" in nested
        ? (nested as { phase?: unknown }).phase
        : undefined;
  return value === "primary" || value === "general" ? value : undefined;
}

function safePartyId(value: string | null | undefined): string | undefined {
  return value && /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : undefined;
}

function nestedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function campaignElectionContext(
  campaignId: string,
  responseBody: Record<string, unknown> | null
): Promise<{
  election_id: string;
  election_type: string;
  phase: string;
  party_id?: string;
  nation_id?: string;
} | null> {
  let campaign = nestedRecord(responseBody?.campaign);
  let electionInfo = nestedRecord(campaign?.electionInfo);
  let electionId = campaign?.electionId;

  // Some mutations return only an acknowledgement. Read the campaign's safe
  // election metadata after the game response; this fetch never delays or
  // changes the mutation itself.
  const needsElectionMetadata =
    typeof electionId !== "string" ||
    !OBJECT_ID.test(electionId) ||
    typeof electionInfo?.electionType !== "string" ||
    (electionInfo?.phase !== "primary" && electionInfo?.phase !== "general");
  if (needsElectionMetadata) {
    try {
      const response = await window.fetch(`/api/campaigns/${campaignId}`, { cache: "no-store" });
      if (response.ok) {
        const payload = nestedRecord(await response.json());
        const fetchedCampaign = nestedRecord(payload?.campaign);
        if (fetchedCampaign) {
          campaign = { ...campaign, ...fetchedCampaign };
          electionInfo = nestedRecord(fetchedCampaign.electionInfo) ?? electionInfo;
          electionId = campaign.electionId;
        }
      }
    } catch {
      // Keep any valid metadata returned by the mutation response.
    }
  }

  if (typeof electionId !== "string" || !OBJECT_ID.test(electionId)) return null;
  const electionType = electionInfo?.electionType;
  const phase = electionInfo?.phase;
  const countryId = campaign?.countryId;
  return {
    election_id: electionId,
    election_type:
      typeof electionType === "string" ? safeElectionType({ electionType }) : "unknown",
    phase: phase === "primary" || phase === "general" ? phase : "unknown",
    ...(safePartyId(typeof campaign?.party === "string" ? campaign.party : undefined)
      ? { party_id: safePartyId(campaign?.party as string) }
      : {}),
    ...(typeof countryId === "string" && NATION_ID.test(countryId) ? { nation_id: countryId } : {}),
  };
}

function depthActionProperties(
  family: DepthFamily,
  pathname: string,
  body: Record<string, unknown> | null
): Record<string, string> {
  const segments = getSegments(pathname);
  if (family === "party") {
    const groups: Array<[string, string[]]> = [
      ["leadership", ["leadership", "election"]],
      ["conference", ["conference", "committee"]],
      ["caucus", ["caucuses"]],
      ["treasury", ["treasury", "treasury-plan", "donate", "send", "transfer", "tax"]],
      [
        "organization",
        [
          "bulk-org",
          "registration-drive",
          "suppression",
          "ps-investment",
          "gotv",
          "priority-region",
        ],
      ],
      ["campaign", ["campaigners", "slate"]],
      ["membership", ["join", "leave", "join-requests", "recruitment", "purge"]],
    ];
    return {
      activity_group:
        groups.find(([, tokens]) => tokens.some((token) => segments.includes(token)))?.[0] ??
        "administration",
    };
  }
  if (family === "corporation") {
    return {
      activity_group: segments.includes("bank")
        ? "banking"
        : segments.includes("sectors")
          ? "production"
          : segments.includes("subsidiary")
            ? "subsidiary"
            : segments.includes("ceo") || segments.includes("votes")
              ? "governance"
              : segments.includes("supply-agreements") || segments.includes("supply-listings")
                ? "supply"
                : "administration",
    };
  }
  if (family === "market") {
    return {
      instrument_type: segments.includes("forex")
        ? "currency"
        : segments.includes("commodities")
          ? "commodity"
          : segments.includes("bonds")
            ? "bond"
            : segments.includes("index-funds") || segments.includes("investment-funds")
              ? "fund"
              : "equity",
    };
  }
  if (family === "crisis")
    return {
      decision_type:
        body?.decline === true
          ? "decline"
          : typeof body?.pctGdp === "number"
            ? "aid_pledge"
            : "decision",
    };
  if (family === "battle")
    return { command_type: segments.includes("auto-join") ? "standing_order" : "offensive" };
  return {
    activity_group: segments.includes("peace")
      ? "peace"
      : segments.includes("trade")
        ? "trade"
        : segments.includes("central-bank")
          ? "central_bank"
          : segments.includes("international-organizations") || segments.includes("intorg")
            ? "international_organization"
            : "international_relations",
  };
}

function depthEntityProperties(
  family: DepthFamily,
  body: Record<string, unknown> | null,
  result: Record<string, unknown> | null,
  pathname: string
): Record<string, string> {
  const properties: Record<string, string> = {};
  const idFields: Array<[string, string]> =
    family === "corporation"
      ? [["corporationId", "corporation_id"]]
      : family === "market"
        ? [
            ["corporationId", "corporation_id"],
            ["orderId", "order_id"],
            ["listingId", "listing_id"],
          ]
        : family === "battle" || family === "diplomacy"
          ? [
              ["conflictId", "conflict_id"],
              ["theaterId", "conflict_id"],
            ]
          : family === "crisis"
            ? [["crisisId", "crisis_id"]]
            : [];
  for (const [field, property] of idFields) {
    const value = result?.[field] ?? body?.[field];
    if (typeof value === "string" && (OBJECT_ID.test(value) || UUID.test(value)))
      properties[property] = value;
  }
  const segments = pathname.split("/").filter(Boolean);
  const partyIndex = segments.findIndex((segment) => segment === "parties" || segment === "party");
  const partyId = segments[partyIndex + 1];
  if (
    family === "party" &&
    partyIndex >= 0 &&
    partyId &&
    (/^\d{1,10}$/.test(partyId) || OBJECT_ID.test(partyId))
  )
    properties.target_party_id = partyId;
  const targetNation = result?.targetCountry ?? body?.targetCountry;
  if (
    (family === "battle" || family === "diplomacy") &&
    typeof targetNation === "string" &&
    NATION_ID.test(targetNation)
  )
    properties.target_nation_id = targetNation;
  return properties;
}

/** Passive onboarding and cosmetic account edits do not activate a character. */
function isMeaningfulGameAction(route: PlayerActionRoute, actionType: string): boolean {
  if (route.action_domain === "onboarding") return false;
  if (route.action_domain !== "character") return true;
  return [
    "resign",
    "retire",
    "transfer",
    "travel",
    "train",
    "invest",
    "donate",
    "join",
    "leave",
    "vote",
  ].includes(actionType);
}

async function trackActionResponse(
  route: PlayerActionRoute,
  response: Response,
  body: Record<string, unknown> | null,
  context: PlayerActionContext,
  generation: number
): Promise<void> {
  const current = () =>
    isAnalyticsGenerationCurrent(generation) &&
    context.userId === actionContext.userId &&
    getStoredConsent() === "accepted";
  if (!current()) return;
  const base = {
    action_domain: route.action_domain,
    action_type:
      typeof body?.action === "string" && ACTION_VERBS.has(body.action)
        ? body.action
        : route.action_type,
    scope: route.scope,
    entity_type: route.entity_type,
    entity_id: route.entity_id ?? "unknown",
    ...((route.nation_id ??
    (context.nationId && NATION_ID.test(context.nationId) ? context.nationId : undefined))
      ? { nation_id: route.nation_id ?? context.nationId! }
      : {}),
  };

  let resultBody: Record<string, unknown> | null = null;
  if (response.ok) {
    try {
      resultBody = await response.json();
    } catch {
      // Mutation endpoints may return no JSON body.
    }
  }

  if (!current()) return;
  if (!response.ok || resultBody?.success === false) {
    await captureProductEvent("player_action_rejected", {
      ...base,
      failure_code: response.ok ? "action_rejected" : failureCode(response.status),
    });
    return;
  }

  const entity = nestedRecord(resultBody?.[route.entity_type]);
  const returnedId =
    resultBody?.[`${route.entity_type}Id`] ??
    entity?.id ??
    entity?._id ??
    resultBody?.id ??
    body?.[`${route.entity_type}Id`] ??
    (route.entity_type === "battle" ? body?.theaterId : undefined);
  if (
    !route.entity_id &&
    typeof returnedId === "string" &&
    (OBJECT_ID.test(returnedId) || UUID.test(returnedId))
  )
    base.entity_id = returnedId;

  const spend = safeSpend(resultBody, "response") ??
    safeSpend(body) ?? { resource_type: "none", resource_amount: 0 };
  await captureProductEvent("player_action_succeeded", {
    ...base,
    ...(spend ?? {}),
  });
  if (!current()) return;
  if (route.depth_family) {
    const marketSide = body?.type === "buy" || body?.type === "sell" ? body.type : undefined;
    await captureProductEvent(`${route.depth_family}_action_succeeded`, {
      ...base,
      ...spend,
      ...depthEntityProperties(route.depth_family, body, resultBody, route.pathname),
      ...depthActionProperties(route.depth_family, route.pathname, body),
      party_id: safePartyId(context.partyId) ?? "unknown",
      ...(marketSide && route.depth_family === "market" ? { order_side: marketSide } : {}),
      ...((safeRegionId(resultBody) ?? safeRegionId(body))
        ? { target_region_id: safeRegionId(resultBody) ?? safeRegionId(body)! }
        : {}),
    });
  }
  if (!current()) return;
  if (context.characterId && isMeaningfulGameAction(route, base.action_type)) {
    await captureFirstMeaningfulAction(context.characterId, {
      action_domain: route.action_domain,
      action_type: base.action_type,
    });
  }

  if (!current()) return;
  const regionId = safeRegionId(resultBody) ?? safeRegionId(body);
  if (route.election) {
    await captureProductEvent("election_action_succeeded", {
      election_id: route.election.election_id,
      election_type: safeElectionType(resultBody),
      phase: safeElectionPhase(resultBody) ?? route.election.phase,
      action_type: route.election.action_type,
      party_id: safePartyId(context.partyId) ?? "unknown",
      target_region_id: regionId ?? "unknown",
      cost_type: spend?.resource_type ?? "none",
      cost_amount: spend?.resource_amount ?? 0,
      ...(route.nation_id ? { nation_id: route.nation_id } : {}),
    });
    return;
  }
  if (!route.campaign) return;
  const election = await campaignElectionContext(route.campaign.campaign_id, resultBody);
  if (!election || !current()) return;
  await captureProductEvent("election_action_succeeded", {
    election_id: election.election_id,
    election_type: election.election_type,
    phase: election.phase,
    action_type: route.action_type,
    party_id: election.party_id ?? safePartyId(context.partyId) ?? "unknown",
    target_region_id: regionId ?? "unknown",
    cost_type: spend?.resource_type ?? "none",
    cost_amount: spend?.resource_amount ?? 0,
    ...(election.nation_id ? { nation_id: election.nation_id } : {}),
  });
}

function requestPath(input: RequestInfo | URL): { pathname: string; method: string } | null {
  try {
    const source = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
    const url = new URL(source, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return {
      pathname: url.pathname,
      method: typeof input === "object" && "method" in input ? input.method : "GET",
    };
  } catch {
    return null;
  }
}

/** Observe authenticated player game mutations after their API response returns. */
export function installPlayerActionAnalytics(): () => void {
  if (installedFetch) return () => {};
  originalFetch = window.fetch;
  const delegate = originalFetch.bind(window);
  const wrapped: typeof window.fetch = async (input, init) => {
    const currentContext = actionContext;
    const { generation } = getAnalyticsAccount();
    const request = requestPath(input);
    const route = request
      ? classifyPlayerActionRoute(request.pathname, init?.method ?? request.method)
      : null;
    const shouldTrack =
      route !== null && getStoredConsent() === "accepted" && !!currentContext.userId;
    const bodyPromise = shouldTrack ? readRequestBody(input, init) : null;
    const response = await delegate(input, init);
    if (route && shouldTrack) {
      let observedResponse: Response;
      try {
        observedResponse = response.clone();
      } catch {
        return response;
      }
      void (async () => {
        // Let body inspection share the request clone opened before fetch sends it.
        const body = await bodyPromise;
        await trackActionResponse(route, observedResponse, body, currentContext, generation);
      })().catch(() => {
        // Analytics must not affect the API response or the game action.
      });
    }
    return response;
  };
  installedFetch = wrapped;
  window.fetch = wrapped;
  return () => {
    if (window.fetch === installedFetch && originalFetch) window.fetch = originalFetch;
    installedFetch = null;
    originalFetch = null;
  };
}
