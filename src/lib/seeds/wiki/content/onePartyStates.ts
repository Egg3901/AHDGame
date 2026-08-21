export const onePartyStatesContent = `# One-Party States

Twelve countries in A House Divided run as **one-party states**: CN, RU, DD, PL, CS, HU, RO, BG, YU, UKR, BLR, and BAL. In each, a single party (the *ruling party*) controls government formation, executive offices, and legislative direction, while other parties may exist in tolerated or banned forms. China (CN) was the first country modelled this way; the system is generic and every listed country follows the same rules, with a small amount of country-specific flavor (chamber names, bespoke executive-hub copy) layered on top.

## The three party tiers

Each party in a one-party state carries a **regime status** that determines what it can and cannot do:

| Tier | Color | Who | What they can do |
| --- | --- | --- | --- |
| **Ruling** | Green | The single party in government (CN: CCP; RU: CPSU; DD: SED) | Everything: forms government, fields executive candidates, proposes/votes on bills, invites coalitions, accepts donations, holds cabinet |
| **Approved** | Yellow | Tolerated minor parties (CN: CDL, CNDCA) | Hold seats, run candidates for legislative offices, propose/vote on bills, accept donations, sit on cabinet, but **cannot form government** or **field executive candidates** |
| **Banned** | Red | Outlawed parties (CN: none seeded; player-created NPPs land here) | **Nothing.** Cannot field candidates, propose or vote on bills, accept donations, or hold cabinet. Existing seats are vacated immediately when status flips to banned. |

The badge next to a party's abbreviation on its profile and on the parties list shows which tier it belongs to.

## What a one-party state changes

Compared to a parliamentary democracy, several mechanics work differently:

- **Government formation**: only the ruling party can form government. Coalition-loss does not collapse the government: the ruling party keeps its mandate through internal confidence (see below), not through legislative majorities.
- **VONC (vote of no confidence)**: only the ruling party may initiate one. In CN, the standard VONC mechanism is disabled entirely, so the gate is effectively never hit.
- **Coalitions**: only the ruling party may create, invite, or join a coalition. Banned parties are barred from any coalition role.
- **Snap elections**: not available by default for one-party states.
- **Cabinet**: members of banned parties cannot be appointed.
- **Executive offices** (Premier in CN): only the ruling party may field a candidate.

## Legislature structure

Most one-party legislatures are unicameral: a bill passes the single chamber by cast-votes majority and enacts with no assent delay. RU is the exception, its Supreme Soviet is bicameral, so a bill must clear both chambers and a second-chamber rejection kills it outright, since a one-party state has no override chamber. The union republics (UKR, BLR, BAL) are unicameral: their Presidium is a standing organ of the same chamber, not a second house.

## Purges

The ruling leader can order a purge against the party: minor, regional, senior, faction, or extreme severity, each costing more internal confidence than the last. Purges are simulation events (a logged history row), not data deletions. Anti-corruption purges are read by the popular-legitimacy driver as a public benefit rather than repression, unlike the other purge kinds.

## Command economy

The same one-party countries also run a planned economy when the world's command-economy option is active: administered consumer prices instead of supply-and-demand pricing, a wage-fund ceiling that throttles cash growth, and a monetary overhang that feeds back into popular legitimacy and party confidence. Fresh worlds enable this option; admins can disable it for a particular world. Three player-facing seats operate the levers where it is on (Gosplan/Gosbank-equivalent roles for RU/DD, Vice Premier/PBoC Governor for CN), plus SOE director appointments.

## Player parties (NPPs)

When a player creates a new party (an NPP) in a one-party state, the new party is **automatically marked banned** at ratification time. The charter detail page surfaces a clear explanation panel after the third signature lands, describing what the new party can and cannot do.

A banned party can be promoted to *Approved* by a game administrator, or by the ruling leader once the regime is under pressure, through the **selective-concession** liberalization reform (see below), which picks a specific banned party to legalize.

## The regime-legitimacy model

The ruling party isn't immortal. Two coupled scalars drift each turn and govern the regime's survival:

- **Popular Legitimacy**: how the public reads the regime. Driven by the economy, repression intensity, policy alignment with the country's priority profile, and the credibility of elections.
- **Party Confidence**: how stable the ruling party is internally. Driven by intra-party bleed, policy alignment, and a coupling input from popular legitimacy itself: if the public turns on the regime hard enough for long enough, the party starts to crack.

Both scalars also receive a small natural-recovery pull each turn so a single bad event doesn't permanently scar the regime, but recovery is slow enough that reform actions stay meaningful.

## The four-stage escalation chain

As the scalars degrade past thresholds, the regime moves through a four-stage escalation chain:

1. **Public Discontent**: early warning. Citizens are unhappy, but the regime is in no immediate danger.
2. **Mass Unrest**: sustained unhappiness. The leader is offered a decision event with multiple response options (concessions, repression, distraction).
3. **Internal Challenge**: the party itself is splitting. A faction split auto-fires at this stage, spawning a defected approved party. The leader is offered a decision event with multiple options to respond.
4. **Forced Collapse**: the regime falls. The leader chooses between two final-stage options that determine how the conversion happens.

Stage transitions require a dwell window: the regime has to sit in that band for a sustained stretch of turns before progressing, so a single bad turn never collapses a regime. Each stage offers the ruling leader a decision event with a single-slot queue; if the leader ignores it past the timeout, a default plays out.

## Liberalization reforms

The ruling leader has a five-action menu to trade intra-party confidence for popular legitimacy:

- **Legalize a banned party**: pick a banned party to promote to approved.
- **Reduce vote multipliers**: make elections more competitive.
- **Hold an honest by-election**: surrender control over a specific race.
- **Anti-corruption purge**: burn internal favor to clean up public image.
- **Constitutional amendment**: restructure the regime's formal rules.

Each action has its own cooldown and a per-turn boost effect that decays over time. The Regime Health tab on the executive hub shows a multi-turn projection of where each reform pushes the scalars before you spend it.

## Voluntary constitutional convention

Rather than waiting for collapse, the leader can **announce a constitutional convention**: a voluntary off-ramp. The convention runs through three states (announce → draft → ratify); the draft chooses the target government type and reserves a legacy seat package for the former ruling party. On ratification, the system flips to the target type and parks a snap-election marker.

## Forced conversion at Stage 4

If the leader doesn't avert collapse, the Stage 4 decision triggers a forced conversion through the same underlying driver as the voluntary convention. The post-collapse regime is whatever the country's collapse target specifies: for CN, that's a multi-party parliamentary system.

## Player surfaces

- **Country overview**: the public Regime Stability panel shows a high-level severity-colored stage chip and a LARP blurb describing what's happening, without exposing the raw scalars.
- **Executive hub (Premier only)**: the Regime Health tab shows raw scalars, the active escalation stage, the next reform's projected effect, and the action buttons. Selective-concession reforms ask which banned party to legalize at the time of action.
- **Approved-party leadership**: a Regime Offers inbox surfaces any open offers from the regime, e.g. seats reserved in a constitutional convention.
- **Admin** (CN executive hub): a red Admin tab lets admins force a stage transition, set scalars directly, or trigger a forced conversion.

## Currently supported one-party countries

- **China (CN)**: Chinese Communist Party (ruling), China Democratic League and China National Democratic Construction Association (approved), no parties banned by default. Premier is the head of government, elected by NPC delegates. Head of state (President) auto-syncs to the party chair. Collapse target: multi-party parliamentary republic.
- **Soviet Union (RU)**: Communist Party of the Soviet Union (ruling). Premier heads government; a Chairman of the Presidium is elected by a joint sitting of the bicameral Supreme Soviet.
- **East Germany (DD)**: Socialist Unity Party (ruling). General Secretary heads government; a Chairman of the Council of State syncs to the SED chair.
- **PL, CS, HU, RO, BG, YU, UKR, BLR, BAL**: the remaining Eastern Bloc one-party states, largely NPP-governed, using the same generic escalation chain and executive-hub surface derived from each country's configuration.

The system is generic. Any country configured as a one-party state inherits the same escalation chain, liberalization reforms, convention pathway, and decision-event handlers. Only CN and RU support a faction-split defection in the current build (they have a configured breakaway-party name); other countries no-op that step if triggered.

## See also

- The China design notes in the wiki cover CN-specific details: NPC structure, regional makeup, cabinet positions, and the seven macro-regions.
`;
