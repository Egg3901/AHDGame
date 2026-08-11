import { MINISTERIAL_ACTION_CAP } from "@/lib/constants/cabinetMechanicsTypes";

/**
 * Cabinet Guide wiki page. The intro is short static markdown; the full
 * per-country, per-seat reference is rendered live by the `cabinet-guide`
 * widget (src/components/wiki/widgets/CabinetGuide.tsx), which reads the
 * cabinet mechanics constants directly so the page never rots.
 */
export const cabinetGuideContent = `# Cabinet Guide

Every cabinet seat in A House Divided is a real executive office with its own dashboard, metrics, and levers. This guide is the live reference for every country's cabinet: pick a country tab below to see each post in succession order, the metrics it influences, and every action it can take.

## How cabinets are filled

- **Presidential systems (US, NG):** the President nominates and the legislature confirms. See [Cabinet](/wiki/cabinet) and the confirmation process.
- **Parliamentary systems (UK, DE, JP, IE, CN, and the devolved Scottish and Welsh governments):** the head of government appoints ministers directly after [Government Formation](/wiki/government-formation), with no confirmation vote. The whole cabinet resets when the government changes.

## What ministers can do

Each seat combines some of the following levers, all detailed per post in the reference below:

- **Tier settings:** a standing national policy stance that applies passive per-turn metric effects. Free to hold, switchable at any time.
- **Regional targets:** pick one region for focused per-turn effects, sometimes at a small cost to every other region.
- **Emergencies:** one-off interventions that cost a ministerial action and deliver a large temporary effect for a fixed number of turns.
- **Allocations:** divide a national funding pool across regions.
- **Advocacy:** territorial seats can petition for their region, granting a standing boost while active.
- **Bond profiles:** finance seats set the maturity split of sovereign debt issuance.
- **Buildings:** most seats can build persistent assets in regions: portfolio estates (schools, hospitals, embassies, and more), power plants on the energy seat, or multi-turn infrastructure projects on the transport seat. See [Cabinet Projects & Buildings](/wiki/cabinet-projects).

Active mechanics spend **ministerial actions** (cabinet actions in presidential systems). Actions refill daily and cap at ${MINISTERIAL_ACTION_CAP}.

## Per-country reference

Everything below is read directly from the game's configuration, so numbers and descriptions are always current.

\`\`\`cabinet-guide
\`\`\`

## Related

- [Cabinet](/wiki/cabinet): nominations, confirmation, vacancies, and strategy.
- [Cabinet Projects & Buildings](/wiki/cabinet-projects): estates, power plants, and infrastructure in depth.
- [Government Formation](/wiki/government-formation): how parliamentary cabinets are appointed.
`;
