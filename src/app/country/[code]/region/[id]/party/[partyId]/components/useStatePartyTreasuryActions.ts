"use client";

import { useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import { regionPartyApiUrl } from "@/lib/urls";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { parseMoneyAmountInput } from "@/lib/utils/parseMoneyAmountInput";
import type { TreasuryPresetId } from "@/lib/treasury/partyTreasuryPresets";

interface UseStatePartyTreasuryActionsOptions {
  countryCode: string;
  stateId: string;
  partyId: string;
  countryId: string | undefined;
  taxRate: number;
  gotvPercent: number;
  gotvCategory: string;
  gotvGroup: string;
  suppressionPercent: number;
  suppressionCategory: string;
  suppressionGroup: string;
  transferReserveAmount: string;
  memberSupportReserveAmount: string;
  nppRecruitmentReserveAmount: string;
  treasuryPreset: TreasuryPresetId;
  psInvestmentBudget: string;
  fetchStateParty: () => void;
  fetchUser: () => void;
  setMsg: (msg: string) => void;
}

export function useStatePartyTreasuryActions({
  countryCode,
  stateId,
  partyId,
  countryId,
  taxRate,
  gotvPercent,
  gotvCategory,
  gotvGroup,
  suppressionPercent,
  suppressionCategory,
  suppressionGroup,
  transferReserveAmount,
  memberSupportReserveAmount,
  nppRecruitmentReserveAmount,
  treasuryPreset,
  psInvestmentBudget,
  fetchStateParty,
  fetchUser,
  setMsg,
}: UseStatePartyTreasuryActionsOptions) {
  const partyApiBase = regionPartyApiUrl(countryCode, stateId, partyId);
  const { showToast } = useToast();

  const [savingTax, setSavingTax] = useState(false);
  const [savingGotv, setSavingGotv] = useState(false);
  const [savingSuppression, setSavingSuppression] = useState(false);
  const [savingTreasuryPlan, setSavingTreasuryPlan] = useState(false);
  const [savingPsInvestment, setSavingPsInvestment] = useState(false);
  const [transferAmount, setTransferAmount] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [sendMemberId, setSendMemberId] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [donateAmount, setDonateAmount] = useState("");
  const [donating, setDonating] = useState(false);

  const apiPost = async (url: string, body: object, onOk?: () => void) => {
    setMsg("");
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      setMsg(r.ok ? `✓ ${d.message}` : `✗ ${d.error}`);
      if (r.ok) {
        fetchStateParty();
        onOk?.();
      }
    } catch {
      setMsg("✗ Network error");
    }
  };

  const handleSaveTax = async () => {
    setSavingTax(true);
    await apiPost(`${partyApiBase}/tax`, { taxRate });
    setSavingTax(false);
  };

  const handleSavePsInvestment = async () => {
    const budget = Math.max(0, parseMoneyAmountInput(psInvestmentBudget));
    setSavingPsInvestment(true);
    await apiPost(`${partyApiBase}/ps-investment`, { budget });
    setSavingPsInvestment(false);
  };

  const handleSaveGotv = async () => {
    setSavingGotv(true);
    try {
      const r = await fetch(`${partyApiBase}/gotv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gotvBudgetPercent: gotvPercent,
          gotvTargetCategory: gotvCategory || undefined,
          gotvTargetGroup: gotvGroup || undefined,
        }),
      });
      const d = await r.json();
      showToast(r.ok ? d.message : d.error, r.ok ? "success" : "error");
      if (r.ok) fetchStateParty();
    } catch {
      showToast("Network error", "error");
    }
    setSavingGotv(false);
  };

  const handleSaveSuppression = async () => {
    setSavingSuppression(true);
    try {
      const r = await fetch(`${partyApiBase}/suppression`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suppressionBudgetPercent: suppressionPercent,
          suppressionTargetCategory: suppressionCategory || undefined,
          suppressionTargetGroup: suppressionGroup || undefined,
        }),
      });
      const d = await r.json();
      showToast(r.ok ? d.message : d.error, r.ok ? "success" : "error");
      if (r.ok) fetchStateParty();
    } catch {
      showToast("Network error", "error");
    }
    setSavingSuppression(false);
  };

  const handleSaveTreasuryPlan = async () => {
    const payload = {
      transferReserveAmount: Math.max(
        0,
        Math.round(parseMoneyAmountInput(transferReserveAmount) || 0)
      ),
      memberSupportReserveAmount: Math.max(
        0,
        Math.round(parseMoneyAmountInput(memberSupportReserveAmount) || 0)
      ),
      nppRecruitmentReserveAmount: Math.max(
        0,
        Math.round(parseMoneyAmountInput(nppRecruitmentReserveAmount) || 0)
      ),
      gotvBudgetPercent: gotvPercent,
      suppressionBudgetPercent: suppressionPercent,
      treasuryPreset,
    };

    setSavingTreasuryPlan(true);
    await apiPost(`${partyApiBase}/treasury-plan`, payload);
    setSavingTreasuryPlan(false);
  };

  const statePartyCurrencyCode =
    COUNTRY_CURRENCY_MAP[(countryId ?? countryCode) as keyof typeof COUNTRY_CURRENCY_MAP];
  const statePartySymbol = CURRENCY_SYMBOLS[statePartyCurrencyCode] ?? "$";

  const handleTransfer = async () => {
    const amount = Math.round(parseFloat(transferAmount));
    if (!Number.isFinite(amount) || amount < 1000) {
      setMsg(`✗ Enter amount (min. ${statePartySymbol}1,000)`);
      return;
    }
    setTransferring(true);
    await apiPost(`${partyApiBase}/transfer`, { amount }, () => setTransferAmount(""));
    setTransferring(false);
  };

  const handleSendToMember = async () => {
    const amount = Math.round(parseFloat(sendAmount));
    if (!sendMemberId || !Number.isFinite(amount) || amount < 1000) {
      setMsg(`✗ Select a member and enter ${statePartySymbol}1,000+`);
      return;
    }
    setSending(true);
    await apiPost(`${partyApiBase}/send`, { characterId: sendMemberId, amount }, () => {
      setSendMemberId("");
      setSendAmount("");
    });
    setSending(false);
  };

  const handleDonate = async () => {
    const amount = Math.round(parseFloat(donateAmount));
    if (!Number.isFinite(amount) || amount < 1000) {
      setMsg(`✗ Enter amount (min. ${statePartySymbol}1,000)`);
      return;
    }
    setDonating(true);
    await apiPost(`${partyApiBase}/donate`, { amount }, () => {
      setDonateAmount("");
      fetchUser();
    });
    setDonating(false);
  };

  return {
    savingTax,
    savingGotv,
    savingSuppression,
    savingTreasuryPlan,
    savingPsInvestment,
    transferAmount,
    setTransferAmount,
    transferring,
    sendMemberId,
    setSendMemberId,
    sendAmount,
    setSendAmount,
    sending,
    donateAmount,
    setDonateAmount,
    donating,
    handleSaveTax,
    handleSavePsInvestment,
    handleSaveGotv,
    handleSaveSuppression,
    handleSaveTreasuryPlan,
    handleTransfer,
    handleSendToMember,
    handleDonate,
  };
}
