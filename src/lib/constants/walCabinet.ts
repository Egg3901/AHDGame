/**
 * Wales Cabinet (Welsh Government / Llywodraeth Cymru).
 *
 * The First Minister leads the government and appoints Cabinet Secretaries
 * directly — no Senedd confirmation vote (the FM is the head of government,
 * seated via the Appoint-First-Minister flow, so they are not a cabinet seat
 * here). 12 Cabinet Secretaries mirror Westminster's portfolios with Welsh
 * titles; Justice & Home Affairs are one seat. Mechanics + orders are reused
 * from the UK config — see devolvedCabinet.ts. Position ids are shared with
 * Scotland (only the names + departments are nation-specific).
 *
 * `financeSecretary` matches the WAL config's `financeMinisterCabinetId`.
 */
import {
  devolvedCabinetPositions,
  devolvedCabinetMechanics,
  devolvedCabinetOrders,
  type DevolvedSeat,
} from "./devolvedCabinet";

const WAL_SEATS: DevolvedSeat[] = [
  {
    id: "deputyFirstMinister",
    name: "Deputy First Minister",
    department: "Office of the First Minister",
  },
  { id: "financeSecretary", name: "Cabinet Secretary for Finance", department: "Finance Group" },
  {
    id: "externalAffairsSecretary",
    name: "Cabinet Secretary for External Affairs and the Constitution",
    department: "External Affairs and Constitution Group",
  },
  {
    id: "justiceSecretary",
    name: "Cabinet Secretary for Justice and Home Affairs",
    department: "Justice and Home Affairs Group",
  },
  { id: "defenceSecretary", name: "Cabinet Secretary for Defence", department: "Defence Group" },
  {
    id: "healthSecretary",
    name: "Cabinet Secretary for Health and Social Care",
    department: "Health and Social Services Group",
  },
  {
    id: "educationSecretary",
    name: "Cabinet Secretary for Education",
    department: "Education Group",
  },
  {
    id: "economySecretary",
    name: "Cabinet Secretary for Economy, Energy and Welsh Language",
    department: "Economy, Energy and Welsh Language Group",
  },
  {
    id: "communitiesSecretary",
    name: "Cabinet Secretary for Housing and Local Government",
    department: "Housing and Local Government Group",
  },
  {
    id: "transportSecretary",
    name: "Cabinet Secretary for Transport and North Wales",
    department: "Transport Group",
  },
  {
    id: "netZeroSecretary",
    name: "Cabinet Secretary for Climate Change and Rural Affairs",
    department: "Climate Change and Rural Affairs Group",
  },
  {
    id: "socialJusticeSecretary",
    name: "Cabinet Secretary for Social Justice",
    department: "Social Justice Group",
  },
];

export const WAL_CABINET_POSITIONS = devolvedCabinetPositions(WAL_SEATS);
export const WAL_CABINET_MECHANICS = devolvedCabinetMechanics(WAL_SEATS);
export const WAL_MINISTERIAL_ORDERS = devolvedCabinetOrders(WAL_SEATS);
