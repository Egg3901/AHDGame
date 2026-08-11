// TypeScript interfaces/types for the StatePartyFundraisingPanel and sub-components.

import type { StatePartyData, UserData } from "./types";
import type { TreasuryPresetId } from "@/lib/treasury/partyTreasuryPresets";

export type { StatePartyData, UserData };

export interface StatePartyFundraisingPanelProps {
  stateParty: StatePartyData;
  user: UserData | null;
  isMember: boolean;
  canManageTreas: boolean;
  canManageTreasuryPlan: boolean;
  canChangeTax: boolean;
  // Tax rate
  taxRate: number;
  setTaxRate: (v: number) => void;
  savingTax: boolean;
  handleSaveTax: () => void;
  // PS Investment budget — chair-set per-turn cash spend that debits
  // treasury and converts to PS. The always-on baseline trickle (5%
  // of treasury) stacks on top of this without debiting; the merged
  // PsInvestmentBlock shows both. Chair-override of the trickle %
  // was removed 2026-05-22.
  psInvestmentBudget: string;
  setPsInvestmentBudget: (v: string) => void;
  savingPsInvestment: boolean;
  handleSavePsInvestment: () => void;
  // GOTV
  gotvPercent: number;
  setGotvPercent: (v: number) => void;
  gotvCategory: string;
  setGotvCategory: (v: string) => void;
  gotvGroup: string;
  setGotvGroup: (v: string) => void;
  savingGotv: boolean;
  handleSaveGotv: () => void;
  // Suppression
  suppressionPercent: number;
  setSuppressionPercent: (v: number) => void;
  suppressionCategory: string;
  setSuppressionCategory: (v: string) => void;
  suppressionGroup: string;
  setSuppressionGroup: (v: string) => void;
  savingSuppression: boolean;
  handleSaveSuppression: () => void;
  // Treasurer soft targets
  transferReserveAmount: string;
  setTransferReserveAmount: (v: string) => void;
  memberSupportReserveAmount: string;
  setMemberSupportReserveAmount: (v: string) => void;
  nppRecruitmentReserveAmount: string;
  setNppRecruitmentReserveAmount: (v: string) => void;
  treasuryPreset: TreasuryPresetId;
  setTreasuryPreset: (v: TreasuryPresetId) => void;
  savingTreasuryPlan: boolean;
  handleSaveTreasuryPlan: () => void;
  // Transfer
  transferAmount: string;
  setTransferAmount: (v: string) => void;
  transferring: boolean;
  handleTransfer: () => void;
  // Send to Member
  sendMemberId: string;
  setSendMemberId: (v: string) => void;
  sendAmount: string;
  setSendAmount: (v: string) => void;
  sending: boolean;
  handleSendToMember: () => void;
  // Status message
  msg: string;
  // Sorted members (non-NPP)
  sortedMembers: Array<{ id: string; name: string; isNPP: boolean }>;
  // Donate (members only)
  donateAmount: string;
  setDonateAmount: (v: string) => void;
  donating: boolean;
  handleDonate: () => void;
}
