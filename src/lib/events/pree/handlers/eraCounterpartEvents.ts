/**
 * Handlers for the era-gated period-counterpart events
 * (`eraCounterpartDefinitions.ts`). Radio for the viral clip, a TV debut for
 * the social pile-on, a print feud, and the ward boss for the corrupt donor —
 * so early-era presets keep the politics genre once the modern media events
 * are year-gated out.
 *
 * Option ids, labels, descriptions, and `defaultOptionId` MUST stay in
 * lockstep with the matching seed definition (the approve route and the
 * seed-catalog test reject drift). Outcomes are three-tier tables built with
 * `threeTierTable`, mirroring the magnitudes of their modern counterparts
 * (campaignViral / corruptDonor).
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { buildElectionPayload } from "../payload";
import { threeTierTable } from "./tiers";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

// ── pree.radioAddressSensation (counterpart of pree.campaignViral) ─────────

registerEventHandler({
  kind: "pree.radioAddressSensation",
  defaultOptionId: "nothing",
  options: [
    {
      id: "leanIn",
      label: "Lean in and book more airtime",
      description: "Keep talking while it's hot.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Favorable surge",
        "Solid bump",
        "Gaffe backlash",
        [
          { type: "campaignSupport", delta: 6 },
          { type: "favorability", delta: 2 },
        ],
        [{ type: "campaignSupport", delta: 2 }],
        [{ type: "favorability", delta: -3 }]
      ),
    },
    {
      id: "disciplined",
      label: "Stay disciplined",
      description: "Stick to the message.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Measured gain",
        "Small lift",
        "Flat reception",
        [{ type: "campaignSupport", delta: 3 }],
        [{ type: "campaignSupport", delta: 1 }],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "equalTime",
      label: "Demand equal time and a correction",
      description: "Press the stations for fairness.",
      outcomeTable: threeTierTable(
        "Correction airs",
        "Stations shrug",
        "Feud with the broadcasters",
        [{ type: "favorability", delta: 1 }],
        [],
        [{ type: "favorability", delta: -2 }]
      ),
    },
    {
      id: "nothing",
      label: "Do nothing",
      description: "Let it play out.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Organic lift",
        "No change",
        "Support slips",
        [{ type: "campaignSupport", delta: 1 }],
        [],
        [{ type: "campaignSupport", delta: -2 }]
      ),
    },
  ],
  async buildPayload(ctx) {
    return buildElectionPayload(ctx);
  },
  applyEffects: apply,
});

// ── pree.televisionDebut ────────────────────────────────────────────────────

registerEventHandler({
  kind: "pree.televisionDebut",
  defaultOptionId: "refuseTv",
  options: [
    {
      id: "embraceMedium",
      label: "Embrace the new medium",
      description: "Speak to the camera like it's a voter's living room.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Natural on camera",
        "Solid debut",
        "Sweating under the lights",
        [{ type: "favorability", delta: 5 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: -4 }]
      ),
    },
    {
      id: "stickScript",
      label: "Stick to the prepared script",
      description: "Read your remarks and take no risks.",
      outcomeTable: threeTierTable(
        "Composed and credible",
        "A bit stiff",
        "Wooden delivery",
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "refuseTv",
      label: "Refuse future TV appearances",
      description: "Declare television a fad and stick to radio and print.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Radio carries you",
        "Print covers you fine",
        "Looks out of touch",
        [],
        [],
        [{ type: "favorability", delta: -2 }]
      ),
    },
    {
      id: "downplay",
      label: "Downplay the whole thing",
      description: "Treat it as just another speech.",
      outcomeTable: threeTierTable(
        "Quietly forgotten",
        "No ripple",
        "Rivals fill the airwaves",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  applyEffects: apply,
});

// ── pree.newspaperFeud ──────────────────────────────────────────────────────

registerEventHandler({
  kind: "pree.newspaperFeud",
  defaultOptionId: "ignoreDignified",
  options: [
    {
      id: "respondInKind",
      label: "Respond in kind",
      description: "Answer him column for column, barb for barb.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "You win the exchange",
        "Even exchange",
        "Feud escalates",
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 1 }],
        [
          { type: "favorability", delta: -4 },
          { type: "infamy", delta: 3 },
        ]
      ),
    },
    {
      id: "ignoreDignified",
      label: "Ignore it with dignity",
      description: "Never wrestle with a man who buys ink by the barrel.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Columnist looks petty",
        "Storm passes",
        "Story metastasizes",
        [{ type: "favorability", delta: 2 }],
        [],
        [{ type: "favorability", delta: -2 }]
      ),
    },
    {
      id: "sueLibel",
      label: "Sue for libel",
      description: "Retain counsel and take him to court.",
      outcomeTable: threeTierTable(
        "Settlement in your favor",
        "Case drags on",
        "Lose in open court",
        [
          { type: "personalWealth", deltaAnchor: -10_000 },
          { type: "favorability", delta: 3 },
        ],
        [{ type: "personalWealth", deltaAnchor: -10_000 }],
        [
          { type: "personalWealth", deltaAnchor: -10_000 },
          { type: "favorability", delta: -3 },
        ]
      ),
    },
    {
      id: "inviteDinner",
      label: "Invite the columnist to dinner",
      description: "Try to charm him off the warpath.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Columnist charmed",
        "Truce over dessert",
        "Dinner becomes a column",
        [{ type: "favorability", delta: 3 }],
        [{ type: "favorability", delta: 1 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
  ],
  applyEffects: apply,
});

// ── pree.partyMachineDonor (counterpart of pree.corruptDonor) ───────────────

registerEventHandler({
  kind: "pree.partyMachineDonor",
  defaultOptionId: "sayNothing",
  options: [
    {
      id: "accept",
      label: "Accept the envelope",
      description: "Take the cash and owe the machine.",
      outcomeTable: threeTierTable(
        "Money arrives quietly",
        "Money with strings",
        "Envelope traced",
        [{ type: "campaignFunds", deltaLocal: 50_000 }],
        [
          { type: "campaignFunds", deltaLocal: 25_000 },
          { type: "infamy", delta: 1 },
        ],
        [
          { type: "campaignFunds", deltaLocal: 25_000 },
          { type: "infamy", delta: 5 },
          { type: "favorability", delta: -4 },
        ]
      ),
    },
    {
      id: "refuse",
      label: "Refuse politely",
      description: "Thank him and decline the money.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Clean hands praised",
        "Respectful decline",
        "Boss holds a grudge",
        [{ type: "favorability", delta: 2 }],
        [],
        [
          { type: "campaignSupport", delta: -2 },
          { type: "favorability", delta: -1 },
        ]
      ),
    },
    {
      id: "report",
      label: "Report it to the authorities",
      description: "Turn the ward boss in.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Reformer credentials",
        "Story gets a day",
        "Machine retaliates",
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 1 }],
        [
          { type: "favorability", delta: -5 },
          { type: "infamy", delta: 4 },
        ]
      ),
    },
    {
      id: "sayNothing",
      label: "Say nothing and move on",
      description: "Neither accept nor refuse; just change the subject.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Offer withdrawn",
        "Ward goes cold",
        "Boss backs your rival",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "campaignSupport", delta: -2 }]
      ),
    },
  ],
  async buildPayload(ctx) {
    return buildElectionPayload(ctx);
  },
  applyEffects: apply,
});
