"use client";

import { useState, useEffect, useCallback } from "react";
import { regionPartyApiUrl } from "@/lib/urls";
import { fetchJson } from "@/lib/observability/fetchJson";
import { formatTreasuryReserveInputValue } from "@/lib/currency/treasuryReserveDisplay";
import type { TreasuryPresetId } from "@/lib/treasury/partyTreasuryPresets";
import type { StatePartyData, UserData } from "./types";

interface UseStatePartyDataReturn {
  user: UserData | null;
  stateParty: StatePartyData | null;
  currentTurn: number;
  loading: boolean;
  // Controlled treasury state (sync'd from stateParty on fetch)
  taxRate: number;
  setTaxRate: (v: number) => void;
  gotvPercent: number;
  setGotvPercent: (v: number) => void;
  gotvCategory: string;
  setGotvCategory: (v: string) => void;
  gotvGroup: string;
  setGotvGroup: (v: string) => void;
  suppressionPercent: number;
  setSuppressionPercent: (v: number) => void;
  suppressionCategory: string;
  setSuppressionCategory: (v: string) => void;
  suppressionGroup: string;
  setSuppressionGroup: (v: string) => void;
  orgBuildingPct: number;
  setOrgBuildingPct: (v: number) => void;
  transferReserveAmount: string;
  setTransferReserveAmount: (v: string) => void;
  memberSupportReserveAmount: string;
  setMemberSupportReserveAmount: (v: string) => void;
  nppRecruitmentReserveAmount: string;
  setNppRecruitmentReserveAmount: (v: string) => void;
  treasuryPreset: TreasuryPresetId;
  setTreasuryPreset: (v: TreasuryPresetId) => void;
  // Explicit PS investment budget (in display currency, dollars-equivalent input)
  psInvestmentBudget: string;
  setPsInvestmentBudget: (v: string) => void;
  // Refresh callbacks for child components
  fetchStateParty: () => void;
  fetchUser: () => void;
}

export function useStatePartyData(
  countryId: string,
  stateId: string,
  partyId: string
): UseStatePartyDataReturn {
  const [user, setUser] = useState<UserData | null>(null);
  const [stateParty, setStateParty] = useState<StatePartyData | null>(null);
  const [currentTurn, setCurrentTurn] = useState(0);
  const [loading, setLoading] = useState(true);

  // Treasury-related controlled state
  const [taxRate, setTaxRate] = useState(0);
  const [gotvPercent, setGotvPercent] = useState(0);
  const [gotvCategory, setGotvCategory] = useState("");
  const [gotvGroup, setGotvGroup] = useState("");
  const [suppressionPercent, setSuppressionPercent] = useState(0);
  const [suppressionCategory, setSuppressionCategory] = useState("");
  const [suppressionGroup, setSuppressionGroup] = useState("");
  const [orgBuildingPct, setOrgBuildingPct] = useState(0);
  const [transferReserveAmount, setTransferReserveAmount] = useState("0");
  const [memberSupportReserveAmount, setMemberSupportReserveAmount] = useState("0");
  const [nppRecruitmentReserveAmount, setNppRecruitmentReserveAmount] = useState("0");
  const [treasuryPreset, setTreasuryPreset] = useState<TreasuryPresetId>("custom");
  const [psInvestmentBudget, setPsInvestmentBudget] = useState("0");

  const fetchUser = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/me");
      if (r.ok) {
        const d = await r.json();
        setUser(d.user);
      }
    } catch {}
  }, []);

  const fetchStateParty = useCallback(async () => {
    try {
      const r = await fetch(regionPartyApiUrl(countryId, stateId, partyId));
      if (r.ok) {
        const d = await r.json();
        setStateParty(d.stateParty);
        setTaxRate(d.stateParty.stateTaxRate ?? 0);
        setGotvPercent(d.stateParty.gotvBudgetPercent ?? 0);
        setGotvCategory(d.stateParty.gotvTargetCategory ?? "");
        setGotvGroup(d.stateParty.gotvTargetGroup ?? "");
        setSuppressionPercent(d.stateParty.suppressionBudgetPercent ?? 0);
        setSuppressionCategory(d.stateParty.suppressionTargetCategory ?? "");
        setSuppressionGroup(d.stateParty.suppressionTargetGroup ?? "");
        setOrgBuildingPct(d.stateParty.orgBuildingPercent ?? 0);
        // Post-Phase-6: reserves are stored in the state party's local home
        // currency, identical to the units the form input expects.
        setTransferReserveAmount(
          formatTreasuryReserveInputValue(d.stateParty.transferReserveAmount)
        );
        setMemberSupportReserveAmount(
          formatTreasuryReserveInputValue(d.stateParty.memberSupportReserveAmount)
        );
        setNppRecruitmentReserveAmount(
          formatTreasuryReserveInputValue(d.stateParty.nppRecruitmentReserveAmount)
        );
        setTreasuryPreset(d.stateParty.treasuryPreset ?? "custom");
        // Post-Phase-6: reserves (including psInvestmentBudget) persist in the
        // state party's local home currency, so no currency conversion is
        // needed for display — the simplified formatTreasuryReserveInputValue
        // takes only the amount.
        setPsInvestmentBudget(
          formatTreasuryReserveInputValue(d.stateParty.psInvestmentBudget ?? 0)
        );
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [countryId, stateId, partyId]);

  useEffect(() => {
    fetchUser();
    fetchStateParty();
    fetchJson<{ currentTurn?: number }>("/api/game/turn/status", {
      feature: "state-party-turn-status",
    })
      .then((d) => {
        if (d?.currentTurn) setCurrentTurn(d.currentTurn);
      })
      .catch(() => {});
  }, [stateId, partyId, fetchUser, fetchStateParty]);

  return {
    user,
    stateParty,
    currentTurn,
    loading,
    fetchUser,
    taxRate,
    setTaxRate,
    gotvPercent,
    setGotvPercent,
    gotvCategory,
    setGotvCategory,
    gotvGroup,
    setGotvGroup,
    suppressionPercent,
    setSuppressionPercent,
    suppressionCategory,
    setSuppressionCategory,
    suppressionGroup,
    setSuppressionGroup,
    orgBuildingPct,
    setOrgBuildingPct,
    transferReserveAmount,
    setTransferReserveAmount,
    memberSupportReserveAmount,
    setMemberSupportReserveAmount,
    nppRecruitmentReserveAmount,
    setNppRecruitmentReserveAmount,
    treasuryPreset,
    setTreasuryPreset,
    psInvestmentBudget,
    setPsInvestmentBudget,
    fetchStateParty,
  };
}
