/**
 * High-tension society events: four executive decision events (panicBuying,
 * bankRun, civilDefenseFever, warScareProtests), each gated by `minTension`
 * bounds in their definitions (see lib/coldwar/tension.ts bands) so they only
 * fire while the world is genuinely frightened. Per plan §2.2, country events
 * skip the primaryStat roll branch. Gamble options use multi-tier outcome
 * tables over the instance's raw 1-100 roll, exactly like the era-gated Cold
 * War handlers in coldWarWorldEvents.ts.
 *
 * Vacant-executive safety (plan §7): every `defaultOptionId` below is
 * treasury-neutral. The treasury-negative options (release, guarantee, fund)
 * are never the default.
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

registerEventHandler({
  kind: "worldEvents.panicBuying",
  defaultOptionId: "calm",
  options: [
    {
      id: "ration",
      label: "Impose emergency rationing",
      description:
        "Cap purchases by decree. Slows repeat crises, shifts demand into industry and defense, and damages civil liberties.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "Rationing imposed",
          effects: [
            { type: "approvalDelta", delta: -3 },
            { type: "warEmergencyMitigation", pct: 12, durationTurns: 18 },
            { type: "civilLibertiesDelta", delta: -2 },
            { type: "sectorOutputDemandModifier", sectorType: "retail", pct: -8, durationTurns: 8 },
            {
              type: "sectorOutputDemandModifier",
              sectorType: "entertainment",
              pct: -5,
              durationTurns: 8,
            },
            {
              type: "sectorOutputDemandModifier",
              sectorType: "manufacturing",
              pct: 6,
              durationTurns: 8,
            },
            { type: "sectorOutputDemandModifier", sectorType: "defense", pct: 8, durationTurns: 8 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Imposes Emergency Rationing",
            template:
              "{leader} capped purchases of staples by decree as war fears emptied shelves, an unpopular measure that has at least stopped the hoarding.",
          },
        },
      ],
    },
    {
      id: "calm",
      label: "Appeal for calm",
      description: "Address the public and ask households to buy normally.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 40,
          label: "The panic feeds on itself",
          effects: [
            { type: "approvalDelta", delta: -3 },
            { type: "sectorOutputDemandModifier", sectorType: "retail", pct: 10, durationTurns: 4 },
            {
              type: "sectorOutputDemandModifier",
              sectorType: "agriculture",
              pct: 8,
              durationTurns: 4,
            },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "Appeals for Calm Fail as {country} Hoards",
            template:
              "{leader}'s appeal for calm did nothing to slow the hoarding, and empty shelves across {country} have become the image of the war scare.",
          },
        },
        {
          minRoll: 41,
          maxRoll: 100,
          label: "Calm holds",
          effects: [
            { type: "approvalDelta", delta: 1 },
            { type: "sectorOutputDemandModifier", sectorType: "retail", pct: 4, durationTurns: 4 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Steadies After Appeal for Calm",
            template:
              "{leader}'s appeal for calm took the edge off the panic buying, and shopkeepers report queues easing.",
          },
        },
      ],
    },
    {
      id: "release",
      label: "Release strategic stockpiles",
      description:
        "Spend reserves to keep shelves full and buy limited relief without emergency powers.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "The stockpiles are released",
          effects: [
            { type: "approvalDelta", delta: 2 },
            { type: "treasuryDelta", deltaAnchor: -10_000 },
            { type: "warEmergencyMitigation", pct: 8, durationTurns: 10 },
            { type: "sectorOutputDemandModifier", sectorType: "retail", pct: 2, durationTurns: 4 },
            {
              type: "sectorOutputDemandModifier",
              sectorType: "manufacturing",
              pct: 3,
              durationTurns: 6,
            },
            { type: "sectorOutputDemandModifier", sectorType: "defense", pct: 2, durationTurns: 6 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Opens Strategic Stockpiles",
            template:
              "{leader} ordered government reserves moved into the shops, keeping shelves full through the war scare at considerable public expense.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "worldEvents.bankRun",
  defaultOptionId: "standBy",
  options: [
    {
      id: "guarantee",
      label: "Guarantee all deposits",
      description: "Spend heavily to stop the run and buy limited relief.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "The run stops cold",
          effects: [
            { type: "approvalDelta", delta: 3 },
            { type: "treasuryDelta", deltaAnchor: -20_000 },
            { type: "warEmergencyMitigation", pct: 10, durationTurns: 12 },
            {
              type: "sectorOutputDemandModifier",
              sectorType: "financial",
              pct: 3,
              durationTurns: 6,
            },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Guarantees All Deposits",
            template:
              "{leader} put the full weight of the treasury behind every bank account, and the queues outside the branches dissolved within a day.",
          },
        },
      ],
    },
    {
      id: "holiday",
      label: "Declare a bank holiday",
      description:
        "Close banks by decree. Slows repeat crises, suppresses consumer demand, and damages democratic health.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "The banks are shuttered",
          effects: [
            { type: "approvalDelta", delta: -4 },
            { type: "warEmergencyMitigation", pct: 14, durationTurns: 18 },
            { type: "civilLibertiesDelta", delta: -3 },
            {
              type: "sectorOutputDemandModifier",
              sectorType: "financial",
              pct: -8,
              durationTurns: 6,
            },
            { type: "sectorOutputDemandModifier", sectorType: "retail", pct: -6, durationTurns: 8 },
            {
              type: "sectorOutputDemandModifier",
              sectorType: "manufacturing",
              pct: 6,
              durationTurns: 8,
            },
            { type: "sectorOutputDemandModifier", sectorType: "defense", pct: 7, durationTurns: 8 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Declares Bank Holiday",
            template:
              "{leader} closed the banks by decree to break the run. The doors will reopen, but the shutters have frightened depositors as much as the war news did.",
          },
        },
      ],
    },
    {
      id: "standBy",
      label: "Stand by the banks publicly",
      description: "Express confidence and let the system ride it out.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 35,
          label: "Contagion spreads",
          effects: [
            { type: "approvalDelta", delta: -4 },
            {
              type: "sectorOutputDemandModifier",
              sectorType: "financial",
              pct: -10,
              durationTurns: 8,
            },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "Bank Run Spreads Across {country}",
            template:
              "Confidence alone did not hold. The run that began at a handful of branches has spread across {country}, and {leader}'s reassurances ring hollow.",
          },
        },
        {
          minRoll: 36,
          maxRoll: 100,
          label: "The run peters out",
          effects: [
            {
              type: "sectorOutputDemandModifier",
              sectorType: "financial",
              pct: -3,
              durationTurns: 4,
            },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "Bank Queues Ease in {country}",
            template:
              "{leader} expressed public confidence in the banks and the queues thinned by the end of the week.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "worldEvents.civilDefenseFever",
  defaultOptionId: "drills",
  options: [
    {
      id: "fund",
      label: "Fund a national shelter program",
      description:
        "Fund shelters and wartime production. Buys limited relief while shifting demand toward industry and defense.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "The shelters go up",
          effects: [
            { type: "approvalDelta", delta: 2 },
            { type: "treasuryDelta", deltaAnchor: -15_000 },
            { type: "warEmergencyMitigation", pct: 10, durationTurns: 14 },
            { type: "sectorOutputDemandModifier", sectorType: "retail", pct: -3, durationTurns: 8 },
            {
              type: "sectorOutputDemandModifier",
              sectorType: "construction",
              pct: 8,
              durationTurns: 8,
            },
            {
              type: "sectorOutputDemandModifier",
              sectorType: "manufacturing",
              pct: 6,
              durationTurns: 8,
            },
            { type: "sectorOutputDemandModifier", sectorType: "defense", pct: 8, durationTurns: 8 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Funds National Shelter Program",
            template:
              "{leader} answered the civil defense fever with money: public shelters and stocked basements are going up in every city in {country}.",
          },
        },
      ],
    },
    {
      id: "drills",
      label: "Order drills and leaflets",
      description:
        "Mobilize civil defense. Slows repeat crises modestly and slightly erodes civil liberties.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "Drills and leaflets",
          effects: [
            { type: "approvalDelta", delta: 1 },
            { type: "warEmergencyMitigation", pct: 8, durationTurns: 12 },
            { type: "civilLibertiesDelta", delta: -1 },
            { type: "sectorOutputDemandModifier", sectorType: "retail", pct: -2, durationTurns: 6 },
            {
              type: "sectorOutputDemandModifier",
              sectorType: "construction",
              pct: 3,
              durationTurns: 6,
            },
            {
              type: "sectorOutputDemandModifier",
              sectorType: "manufacturing",
              pct: 3,
              durationTurns: 6,
            },
            { type: "sectorOutputDemandModifier", sectorType: "defense", pct: 4, durationTurns: 6 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Orders Civil Defense Drills",
            template:
              "Sirens sounded on schedule across {country} as {leader} ordered nationwide drills and mailed preparedness leaflets to every household.",
          },
        },
      ],
    },
    {
      id: "dismiss",
      label: "Dismiss the panic",
      description: "Call the fever overblown and refuse to feed it.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "The fever is dismissed",
          effects: [{ type: "approvalDelta", delta: -2 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "{country} Dismisses Shelter Fever",
            template:
              "{leader} called the shelter fever overblown and declined to fund it, a line that landed badly with frightened families.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "worldEvents.warScareProtests",
  defaultOptionId: "acknowledge",
  options: [
    {
      id: "address",
      label: "Address the nation",
      description: "Speak directly to the fear and buy a little breathing room.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 30,
          label: "The speech falls flat",
          effects: [
            { type: "approvalDelta", delta: -2 },
            { type: "warEmergencyMitigation", pct: 4, durationTurns: 8 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{leader}'s Address Fails to Quiet {country}",
            template:
              "{leader} spoke to the nation about the war scare, but the marches were larger the next day.",
          },
        },
        {
          minRoll: 31,
          maxRoll: 100,
          label: "The nation rallies",
          effects: [
            { type: "approvalDelta", delta: 3 },
            { type: "warEmergencyMitigation", pct: 4, durationTurns: 8 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{leader} Rallies {country} Amid War Scare",
            template:
              "{leader} met the fear head-on in a national address, and the mood in the squares shifted from anger toward resolve.",
          },
        },
      ],
    },
    {
      id: "acknowledge",
      label: "Let them march",
      description: "Acknowledge the protests and let them run their course.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "The marches run their course",
          effects: [{ type: "approvalDelta", delta: -2 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "Peace Marches Fill the Squares of {country}",
            template:
              "Crowds demanding peace filled the squares of {country}. {leader}'s government acknowledged the marches and let them run their course.",
          },
        },
      ],
    },
    {
      id: "crackdown",
      label: "Disperse the marches",
      description:
        "Clear the squares. Strongly slows repeat crises and mobilizes wartime industry at a severe democratic cost.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "The squares are cleared",
          effects: [
            { type: "approvalDelta", delta: -6 },
            { type: "warEmergencyMitigation", pct: 18, durationTurns: 24 },
            { type: "civilLibertiesDelta", delta: -7 },
            {
              type: "sectorOutputDemandModifier",
              sectorType: "retail",
              pct: -8,
              durationTurns: 10,
            },
            {
              type: "sectorOutputDemandModifier",
              sectorType: "entertainment",
              pct: -10,
              durationTurns: 10,
            },
            {
              type: "sectorOutputDemandModifier",
              sectorType: "manufacturing",
              pct: 8,
              durationTurns: 10,
            },
            {
              type: "sectorOutputDemandModifier",
              sectorType: "defense",
              pct: 10,
              durationTurns: 10,
            },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "Police Clear Peace Marches in {country}",
            template:
              "{leader} ordered the squares cleared. The images of police lines breaking up candlelit marches have done the government no favors.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});
