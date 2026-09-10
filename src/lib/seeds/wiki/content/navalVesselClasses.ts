export const navalVesselClassesContent = `# Naval Vessel Classes & Standing Orders

## In short

Your navy is made of five hull types. Each formation sits in one sea region (its **station**) and holds one **posture** (a standing order) until you change it. The carrier is the only hull that can fly missions and the only one whose weapons reach inland. Destroyers and frigates screen the fleet and shoot down aircraft. Submarines hide and squeeze sea lanes. Amphibious groups carry marines. Costs and upkeep are on [Units, Recruitment & Procurement](/wiki/military-units); this page covers what each hull does once it is at sea.

## The five hulls

| Hull | Personnel | Berth cost | Anti-air share | Flies missions | Role |
| --- | --- | --- | --- | --- | --- |
| Carrier Strike Group | 7,500 | 3 | Highest | Yes | The heaviest hull. Its number is its air wing: it defends itself from the air, and it is the only hull that projects power over a coast. Ten turns to build before it can fight. |
| Guided-Missile Destroyer | 330 | 1 | High | No | The dedicated anti-air escort. Second only to the carrier at shooting down strikes. |
| Attack Submarine | 130 | 1 | Almost none | No | Hard to find, weak in a stand-up fight, cheap to keep on a lane. Its default job is sea denial. |
| Frigate Squadron | 600 | 1 | Moderate | No | The light escort. Cheapest hull to buy and run. |
| Amphibious Group | 2,800 | 2 | Low | No | Carries marines. Landing them across water needs your side to hold at least 65 sea control in the adjacent water. |

Combat weight ranks carrier, submarine, amphibious group, destroyer, frigate, in that order. A formation is worth what the rest of the military system says it is worth, after readiness, equipment, veterancy, damage and supply.

**Berth cost** is the footprint a hull asks of the port it operates from. An ally's port gives you three quarters of its berths, a neutral's less than half, a hostile coast a fifth. Formations over capacity lose supply. The defence seat can build port works (three turns, one project at a time) to add capacity.

## Postures (standing orders)

A posture persists across turns. Each costs readiness every turn it is held, and readiness regenerates slowly, so a fleet cannot hold an aggressive posture forever.

| Posture | Readiness cost per turn | What it does |
| --- | --- | --- |
| Blockade | 14 | Full weight on closing the lane. Highest signature: you are sitting still where everyone can see you. |
| Sea Control | 12 | Fight for the water. Full weight in a surface action, some lane pressure. |
| Sea Denial | 10 | Submarine posture. Lowest signature, roughly two thirds of the hull's weight on the lane, weak in a stand-up fight. |
| Escort | 8 | Screen the group. Doubles this hull's anti-air contribution. Very little lane pressure. |
| Transit | 10 | Move. Fights badly while moving, closes nothing. |
| Return to Port | Recovers 30 | Rest, rearm and repair. Projects nothing. |

A carrier given an air mission (patrol, strike, close air support and so on) is flying, not sailing: it applies no lane pressure and fights at reduced weight while its wing is up.

### Default orders

Formations you have not ordered follow a fixed priority list: return to port if condition is below 35 percent or readiness below 25; return to port in peacetime; Sea Control if a hostile fleet shares the region; Sea Denial for submarines; Blockade if the station is on an enemy's trade approaches; otherwise Transit. It is a rule list, not an AI, so you can out-think it.

## Surface actions, sea control, detection

Wherever two hostile fleets share a region and at least one is on Blockade, Sea Control or Sea Denial, they fight that turn. The result is deterministic: the heavier side wins and the margin decides the damage. A wrecked formation is not deleted; it keeps its general and rebuilds through the normal reinforcement path.

Each country holds a **sea control** figure from 0 to 100 per region. It moves toward your share of the weight present, rising 12 points a turn and falling 15, so leaving a lane costs more than returning earns. Uncontested presence builds it on its own.

**Detection** runs from 0 to 3 per region. Anti-ship strikes need level 2 or better on the target, so a fleet can be known to exist and still not be attackable. It decays one band per turn once you leave.

## Repair and losses

Hulls mend between fights, never during one: 12 condition a turn in port, 5 on station, scaled by supply. Free repair caps at 100 in a home port, 90 in an allied port and 80 anywhere else. Once the fleet's average condition drops below 70, war approval takes a growing penalty. It is a cost only; holding the sea earns no approval bonus.

## Where to find it in game

The defence seat holder (or an admin) commands the whole force from **Naval and air command** under the country page, reached from the Commands tab of the defence cabinet office. Conflicts must be enabled for the page to exist.

## Related pages

- [Blockades](/wiki/blockades): turning lane pressure into closed trade
- [Fighting a Battle](/wiki/fighting-a-battle): how sea and air support reach a land front
- [Military Commands](/wiki/military-commands): the command structure
`;
