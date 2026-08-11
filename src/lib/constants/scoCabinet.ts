/**
 * Scotland Cabinet (Scottish Government / Riaghaltas na h-Alba).
 *
 * The First Minister leads the government from Bute House and appoints Cabinet
 * Secretaries directly — no Holyrood confirmation vote (the FM is the head of
 * government, seated via the Appoint-First-Minister flow, so they are not a
 * cabinet seat here). 12 Cabinet Secretaries mirror Westminster's portfolios
 * with Scottish titles; Justice & Home Affairs are one seat. Mechanics + orders
 * are reused from the UK config — see devolvedCabinet.ts.
 *
 * `financeSecretary` matches the SCO config's `financeMinisterCabinetId`.
 */
import {
  devolvedCabinetPositions,
  devolvedCabinetMechanics,
  devolvedCabinetOrders,
  type DevolvedSeat,
} from "./devolvedCabinet";

const SCO_SEATS: DevolvedSeat[] = [
  {
    id: "deputyFirstMinister",
    name: "Deputy First Minister",
    department: "Office of the First Minister",
  },
  {
    id: "financeSecretary",
    name: "Cabinet Secretary for Finance and the Economy",
    department: "Finance and Economy Directorate",
  },
  {
    id: "externalAffairsSecretary",
    name: "Cabinet Secretary for External Affairs",
    department: "External Affairs Directorate",
  },
  {
    id: "justiceSecretary",
    name: "Cabinet Secretary for Justice and Home Affairs",
    department: "Justice and Home Affairs Directorate",
  },
  {
    id: "defenceSecretary",
    name: "Cabinet Secretary for Defence",
    department: "Defence Directorate",
  },
  {
    id: "healthSecretary",
    name: "Cabinet Secretary for Health and Social Care",
    department: "Health and Social Care Directorate",
  },
  {
    id: "educationSecretary",
    name: "Cabinet Secretary for Education and Skills",
    department: "Education and Skills Directorate",
  },
  {
    id: "economySecretary",
    name: "Cabinet Secretary for the Economy",
    department: "Economy Directorate",
  },
  {
    id: "communitiesSecretary",
    name: "Cabinet Secretary for Communities and Local Government",
    department: "Communities and Local Government Directorate",
  },
  {
    id: "transportSecretary",
    name: "Cabinet Secretary for Transport",
    department: "Transport Scotland",
  },
  {
    id: "netZeroSecretary",
    name: "Cabinet Secretary for Net Zero and Energy",
    department: "Net Zero and Energy Directorate",
  },
  {
    id: "socialJusticeSecretary",
    name: "Cabinet Secretary for Social Justice",
    department: "Social Justice Directorate",
  },
];

export const SCO_CABINET_POSITIONS = devolvedCabinetPositions(SCO_SEATS);
export const SCO_CABINET_MECHANICS = devolvedCabinetMechanics(SCO_SEATS);
export const SCO_MINISTERIAL_ORDERS = devolvedCabinetOrders(SCO_SEATS);
