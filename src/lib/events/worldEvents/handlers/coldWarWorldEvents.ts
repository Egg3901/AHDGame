/**
 * Era-gated Cold War world events — five executive decision events
 * (sputnikMoment, berlinCrisis, spaceRaceMilestone, oilEmbargoShock,
 * detenteOverture), each gated by `minYear`/`maxYear` era bounds and (where
 * noted) superpower/bloc `requiresCountryIds` in their definitions. Per plan
 * §2.2, country events skip the primaryStat roll branch — but gamble options
 * still use multi-tier outcome tables over the instance's raw 1-100 roll
 * (the bad tier is the downside of choosing the risky option, not a stat
 * check), exactly like the character-scope PREE handlers.
 *
 * Vacant-executive safety (plan §7): every `defaultOptionId` below is the
 * safe/neutral option with zero treasury cost — the treasury-negative
 * options (propaganda, crash, reserve) are never the default.
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

registerEventHandler({
  kind: "worldEvents.sputnikMoment",
  defaultOptionId: "downplay",
  options: [
    {
      id: "propaganda",
      label: "Maximum propaganda",
      description: "Trumpet the launch as proof of the system's superiority.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 20,
          label: "Overreach ridicule",
          effects: [
            { type: "approvalDelta", delta: -2 },
            { type: "treasuryDelta", deltaAnchor: -15_000 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Propaganda Overreach Draws Ridicule",
            template:
              "{leader}'s triumphalist claims about the satellite launch were mocked abroad as crude overreach, embarrassing {country}.",
          },
        },
        {
          minRoll: 21,
          maxRoll: 100,
          label: "A propaganda triumph",
          effects: [
            { type: "approvalDelta", delta: 5 },
            { type: "treasuryDelta", deltaAnchor: -15_000 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Hails Satellite Triumph",
            template:
              "{leader} proclaimed the satellite launch as proof of the system's superiority.",
          },
        },
      ],
    },
    {
      id: "scientific",
      label: "Sober scientific framing",
      description: "Present the launch as a measured scientific achievement.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "A measured scientific presentation",
          effects: [
            { type: "approvalDelta", delta: 2 },
            { type: "sectorDemandModifier", sectorType: "technology", pct: 3, durationTurns: 6 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Presents Satellite as Scientific Achievement",
            template:
              "{leader} framed the satellite launch as a measured scientific achievement, earning quiet respect at home and abroad.",
          },
        },
      ],
    },
    {
      id: "downplay",
      label: "Downplay militarily",
      description: "Stress the peaceful nature of the program and move on.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "The launch is downplayed",
          effects: [{ type: "treasuryDelta", deltaAnchor: 0 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "{country} Stresses Peaceful Space Program",
            template:
              "{leader}'s government stressed the peaceful nature of the satellite program and declined to celebrate it as a strategic feat.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "worldEvents.berlinCrisis",
  defaultOptionId: "moscow",
  options: [
    {
      id: "seal",
      label: "Seal the border",
      description: "Close the sector border and end the exodus by force.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 30,
          label: "Bloody backlash at the border",
          effects: [{ type: "approvalDelta", delta: -8 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "Bloody Scenes as {country} Seals Border",
            template:
              "The sealing of the sector border under {leader} brought violent scenes and condemnation abroad, though the exodus has stopped.",
          },
        },
        {
          minRoll: 31,
          maxRoll: 100,
          label: "The border is sealed",
          effects: [{ type: "approvalDelta", delta: -5 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "{country} Seals the Sector Border",
            template:
              "{leader} ordered the sector border sealed, halting the refugee exodus at a heavy cost in domestic goodwill and infamy abroad.",
          },
        },
      ],
    },
    {
      id: "conciliate",
      label: "Conciliate and seek talks",
      description: "Ease conditions at home and propose negotiations over the city's status.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "Talks are proposed",
          effects: [{ type: "approvalDelta", delta: 1 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "{country} Proposes Talks Over the City",
            template:
              "{leader} paired modest domestic conciliation with a proposal for negotiations over the city's status.",
          },
        },
      ],
    },
    {
      id: "moscow",
      label: "Request Moscow's guidance",
      description: "Defer to Moscow for direction on handling the crisis.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "Moscow's guidance is sought",
          effects: [
            { type: "approvalDelta", delta: -1 },
            { type: "treasuryDelta", deltaAnchor: 0 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Defers to Moscow on Border Crisis",
            template:
              "{leader} requested Moscow's guidance on the refugee exodus, drawing quiet criticism for indecision at home.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "worldEvents.spaceRaceMilestone",
  defaultOptionId: "cede",
  options: [
    {
      id: "crash",
      label: "Fund the crash program",
      description: "Pour resources into an all-out effort to seize the milestone first.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 30,
          label: "Costly failure",
          effects: [
            { type: "approvalDelta", delta: -3 },
            { type: "treasuryDelta", deltaAnchor: -20_000 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Crash Space Program Fails at Great Cost",
            template:
              "{leader}'s crash program to seize the next space milestone ended in costly failure, and the rival superpower took the prize.",
          },
        },
        {
          minRoll: 31,
          maxRoll: 100,
          label: "The milestone is seized",
          effects: [
            { type: "approvalDelta", delta: 5 },
            { type: "treasuryDelta", deltaAnchor: -20_000 },
            { type: "sectorDemandModifier", sectorType: "technology", pct: 4, durationTurns: 6 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Beats Rival to Space Milestone",
            template:
              "{leader}'s crash program paid off, {country} reached the next space milestone first, to national jubilation.",
          },
        },
      ],
    },
    {
      id: "steady",
      label: "Steady funding",
      description: "Continue the program at a measured, sustainable pace.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "Steady progress",
          effects: [
            { type: "approvalDelta", delta: 1 },
            { type: "treasuryDelta", deltaAnchor: -5_000 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Commits to Steady Space Funding",
            template:
              "{leader} committed {country} to a measured, sustainable space program rather than a headline-grabbing sprint.",
          },
        },
      ],
    },
    {
      id: "cede",
      label: "Cede the milestone",
      description: "Let the rival take this one and conserve resources.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "The milestone is ceded",
          effects: [
            { type: "approvalDelta", delta: -1 },
            { type: "treasuryDelta", deltaAnchor: 0 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Cedes Space Milestone to Rival",
            template:
              "{leader}'s government quietly conceded the next space milestone to the rival superpower, conserving resources at some cost to pride.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "worldEvents.oilEmbargoShock",
  defaultOptionId: "ride",
  options: [
    {
      id: "controls",
      label: "Impose price controls",
      description: "Cap fuel prices by decree to shield consumers from the spike.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "Price controls imposed",
          effects: [
            { type: "approvalDelta", delta: 2 },
            { type: "sectorDemandModifier", sectorType: "energy", pct: -5, durationTurns: 8 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Imposes Fuel Price Controls",
            template:
              "{leader} capped fuel prices by decree, shielding consumers from the embargo-driven spike while dampening energy demand.",
          },
        },
      ],
    },
    {
      id: "reserve",
      label: "Release the strategic reserve",
      description: "Spend down strategic stockpiles to ease the shortage.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "The reserve is released",
          effects: [
            { type: "approvalDelta", delta: 2 },
            { type: "treasuryDelta", deltaAnchor: -10_000 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Releases Strategic Oil Reserve",
            template:
              "{leader} ordered the strategic reserve released to ease the shortage, bringing relief at the pumps at considerable expense.",
          },
        },
      ],
    },
    {
      id: "ride",
      label: "Ride it out",
      description: "Let the market absorb the shock without intervention.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "The shock is ridden out",
          effects: [
            { type: "approvalDelta", delta: -2 },
            { type: "treasuryDelta", deltaAnchor: 0 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Rides Out Oil Shock",
            template:
              "{leader}'s government declined to intervene as fuel prices spiked, leaving motorists to grumble through the queues.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});

registerEventHandler({
  kind: "worldEvents.detenteOverture",
  defaultOptionId: "decline",
  options: [
    {
      id: "summit",
      label: "Pursue the summit",
      description: "Accept the overture and prepare for a leadership summit.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 25,
          label: "Hawks cry appeasement",
          effects: [{ type: "approvalDelta", delta: -2 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "Hawks Cry Appeasement as {country} Pursues Summit",
            template:
              "{leader}'s pursuit of a summit with the rival superpower drew fierce charges of appeasement from hawks at home.",
          },
        },
        {
          minRoll: 26,
          maxRoll: 100,
          label: "A successful summit",
          effects: [{ type: "approvalDelta", delta: 4 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "{country} Pursues Summit with Rival Superpower",
            template:
              "{leader} accepted the back-channel overture and pursued a leadership summit, raising hopes of a thaw in tensions.",
          },
        },
      ],
    },
    {
      id: "concessions",
      label: "Demand concessions first",
      description: "Publicly insist on concrete concessions before any summit.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 40,
          label: "The rival walks away",
          effects: [{ type: "approvalDelta", delta: -2 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "{country} Demands Backfire as Rival Walks Away",
            template:
              "{leader}'s public demand for concessions before any summit soured the overture, and the rival superpower walked away.",
          },
        },
        {
          minRoll: 41,
          maxRoll: 100,
          label: "Concessions extracted",
          effects: [{ type: "approvalDelta", delta: 3 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "{country} Extracts Concessions Ahead of Talks",
            template:
              "{leader}'s firm line extracted concrete concessions from the rival superpower ahead of any summit, playing well at home.",
          },
        },
      ],
    },
    {
      id: "decline",
      label: "Decline quietly",
      description: "Politely let the overture lapse without public comment.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "The overture lapses",
          effects: [{ type: "treasuryDelta", deltaAnchor: 0 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "{country} Lets Summit Overture Lapse",
            template:
              "{leader}'s government quietly let the rival superpower's summit overture lapse without public comment.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});
