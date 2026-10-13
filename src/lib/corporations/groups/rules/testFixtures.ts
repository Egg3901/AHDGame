import type { CoordinationBook } from "./marketCoordination";
import type { SupplyMember } from "./supply";
import { scheduleGroupReceiving } from "./participation";
export function coordinationFixture(): CoordinationBook {
  const seller: SupplyMember = {
    id: "s",
    rootId: "r",
    ceoId: "n",
    operator: "npp",
    vacant: false,
    stateOwned: false,
    cashAvailableAnchor: 1000,
  };
  const buyer: SupplyMember = {
    id: "b",
    rootId: "r",
    ceoId: "p",
    userId: "u",
    ceoTenureKey: "1",
    operator: "player",
    vacant: false,
    stateOwned: false,
    cashAvailableAnchor: 1000,
  };
  buyer.preference = scheduleGroupReceiving(buyer, undefined, true, 0);
  return {
    commodity: "steel",
    turn: 10,
    supply: 100,
    demand: 200,
    unitPriceAnchor: 2,
    freightSettlementActive: false,
    members: [seller, buyer],
    sellers: [
      {
        sectorId: "ss",
        memberId: "s",
        countryId: "US",
        stateId: "CA",
        units: 100,
        physicalUnits: 100,
        committedUnits: 0,
      },
    ],
    buyers: [
      {
        sectorId: "bb",
        memberId: "b",
        countryId: "US",
        stateId: "CA",
        requiredUnits: 100,
        contractedUnits: 0,
      },
      {
        sectorId: "outside",
        memberId: "o",
        countryId: "US",
        stateId: "CA",
        requiredUnits: 100,
        contractedUnits: 0,
      },
    ],
  };
}
