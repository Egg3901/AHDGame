export const globalResponseCrisesContent = `# Global Response Crises

Global Response Crises are persistent international campaigns. They turn historical pressure such as Vietnam, proxy wars, disasters, pandemics, and nuclear alerts into recurring government decisions with consequences that survive the current response window.

Open the system at [World Conflicts](/world/conflicts). The page separates three things:

- **Global tension** shows how dangerous the whole international system is.
- **Response campaigns** show the active historical or emergent situations and their current stage.
- **Shooting wars** show conflicts where military units can actually fight.

These layers affect each other, but they are not the same thing. A proxy campaign can exist before it opens a shooting war. A nuclear buildup can raise tension without creating a battlefield.

## Campaign stages

Every response campaign moves through five stages:

| Stage | What it means |
| --- | --- |
| Posture | Governments assess the situation and establish their opening position. |
| Mobilization | Aid, forces, logistics, and covert networks begin to move. |
| Operations | The campaign is active and its human and strategic costs grow each turn. |
| Settlement | Pressure is moving toward an end state. |
| Aftermath | Immediate fighting or emergency pressure falls, while lasting damage recovers slowly. |

A campaign also records its cycle and turns in the current stage. A later response window continues that history instead of starting from a blank card.

## What your choices remember

The system keeps country-specific memory:

- Credibility
- War weariness
- Military commitment
- Humanitarian commitment
- Covert exposure
- The last response and commitment type

This memory changes later options and outcomes. A government that repeatedly commits forces builds a different position from one that funds relief or stays out. Duplicate submissions cannot apply the same commitment twice.

## Capacity and locked options

Options can require enough treasury capacity, military readiness, logistics, domestic support, intelligence confidence, or the correct campaign stage. A locked choice explains every unmet requirement. The system checks the live country state again when the choice is submitted, so an old browser tab cannot bypass a lost capability.

Countries do not receive identical information. Your role, intelligence confidence, and campaign exposure determine what the briefing reveals. Covert options can hide intent, but exposure risk raises the chance that later consequences become public and damage credibility.

## Persistent consequences

Campaign consequences run from 0 to 100:

- Civilian strain
- Refugees
- Infrastructure damage
- Arms proliferation
- Regional spillover
- Casualties
- Settlement momentum

Mobilization grows proliferation and spillover. Operations increase human and physical damage each turn. Settlement improves settlement momentum. Aftermath reduces several pressures slowly rather than erasing them at once.

## Global tension

The Global Tension Index runs from 0 to 100:

| Reading | Band |
| --- | --- |
| 0 to 14.9 | Detente |
| 15 to 34.9 | Calm |
| 35 to 59.9 | Elevated |
| 60 to 79.9 | Crisis |
| 80 to 100 | Brink |

Events such as escalation, nuclear tests, and crisis outcomes move the current reading immediately. Between events, tension moves toward a pressure floor. The floor is made from:

- A baseline of 12
- 4 points for each Vietnam escalation rung, capped at 30
- 3 points for each active crisis, capped at 12
- 1.2 times the square root of the total world warhead stockpile, capped at 18

The page shows each driver, the floor, and whether the current reading is rising or easing toward it. Tension also sets the displayed DEFCON posture, strategic procurement pressure, and detente penalty.

## Nuclear connection

The nuclear system is a real input, not flavor text. Nuclear tests create immediate tension events. The combined world stockpile raises the standing tension floor. A nuclear alert campaign cannot open until at least two countries have both warheads and an adopted delivery system, so an empty world cannot invent a superpower standoff.

The United States, Soviet Union or Russia, and United Kingdom receive game-scaled historical baseline programs when the world is created. Baselines follow the live game year. They include zero automatic production, so future growth still requires a defence decision and available budget. A migration fills a missing baseline only; it never replaces an existing country's warheads, research, or production order.

Defence ministers manage the program in the Defence Office. The conventional **Nuclear Delivery** doctrine unlocks the nuclear tree. Device nodes require public tests. Delivery nodes are adopted quietly. A stockpile with no delivery leg has no deterrence score.

## Vietnam

Vietnam is the first full campaign family. It can progress from advisers and materiel through air operations, ground commitment, and prolonged war. The United States and Soviet Union answer separately. One response does not close the other country's window.

At the air-campaign rung, the system can open a real North Vietnam versus South Vietnam conflict. The superpowers remain patrons unless another mechanic makes them belligerents. Pulling support below that rung winds the front down. Reaching zero closes the chain permanently.

There is no negotiation mini-game in Global Response Crises. Settlement is driven by campaign state, accumulated consequences, and authored response outcomes.

## Defaults and missed windows

Response windows expire. If a government does not act, the authored cautious default resolves for that country. The campaign continues, records the outcome, and can open another window later. This prevents an inactive office holder from freezing the world system.

The release 1.3 campaign flag is enabled for new worlds. Existing worlds receive an idempotent migration that enables the conflict flags, creates missing campaign rows, completes legacy campaign state, initializes missing tension, and inserts missing nuclear baselines.

## Related systems

- [Conflicts & the Military System](/wiki/conflicts-overview)
- [Crisis Interaction](/wiki/crisis-interaction)
- [National Doctrine](/wiki/national-doctrine)
- [Defence Procurement](/wiki/defence-procurement)
`;
