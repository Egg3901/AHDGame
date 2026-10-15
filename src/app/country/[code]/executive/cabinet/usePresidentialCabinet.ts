"use client";

import { apiErrorText } from "@/lib/errors/catalog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import type { CabinetGroup } from "@/lib/constants/cabinetPositionGroups";
import type { CountryId } from "@/lib/constants/countries";

export interface PositionMember {
  characterId: string;
  sequentialId?: number | null;
  characterName: string;
  party?: string;
  partyName?: string;
  partyColor?: string;
  partyLogoUrl?: string | null;
  avatarUrl?: string | null;
  confirmedAt: string;
  /** Seated directly by the President, without Senate confirmation. */
  acting?: boolean;
  /** Turn the acting appointment lapses. Null on a confirmed holder. */
  actingExpiresOnTurn?: number | null;
}

export interface PositionNomination {
  id: string;
  nomineeCharacterId: string;
  nomineeCharacterName: string;
  nomineeParty?: string;
  nomineePartyName?: string;
  nomineePartyColor?: string;
  status: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  votingEndsAt: string | null;
  myVote: "for" | "against" | "abstain" | null;
}

export interface Position {
  id: string;
  name: string;
  order: number;
  /** Policy bucket the roster table groups this seat under. */
  group?: CabinetGroup;
  /** Filled by the President alone: no Senate vote (US Chief of Staff). */
  appointedWithoutConfirmation?: boolean;
  /** Not in the line of succession, so no "Nth in line" label. */
  outsideSuccession?: boolean;
  member: PositionMember | null;
  nomination: PositionNomination | null;
  /** True once this President has used their one acting appointment here. */
  actingChargeSpent?: boolean;
}

export interface CabinetResponse {
  positions: Position[];
  isPresident: boolean;
  isSenator: boolean;
  isAdmin: boolean;
  currentTurn?: number;
  /** False in countries that fill their cabinet without confirmation. */
  actingEnabled?: boolean;
  actingTenureTurns?: number;
}

export interface NomineeOption {
  _id: string;
  name: string;
  party: string;
  homeState: string;
  currentOffice?: Record<string, unknown> | null;
}

/**
 * Presidential cabinet state and actions: the roster from /api/whitehouse/cabinet
 * plus nominate, acting, vote and fire. Shared by the cabinet page and the
 * White House overview so both render the same seats with the same controls.
 */
export function usePresidentialCabinet(countryId: CountryId) {
  const code = countryId.toLowerCase();
  const countryQuery = `?country=${encodeURIComponent(countryId)}`;
  const { showToast } = useToast();
  const [data, setData] = useState<CabinetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nominateModal, setNominateModal] = useState(false);
  // The acting flow reuses the nominee picker, so it shares the selection
  // state and only differs in which endpoint the submit hits.
  const [actingModal, setActingModal] = useState(false);
  const [selectedPositionId, setSelectedPositionId] = useState("");
  const [selectedCharId, setSelectedCharId] = useState("");
  const [characters, setCharacters] = useState<NomineeOption[]>([]);
  const [npps, setNpps] = useState<NomineeOption[]>([]);
  const [nomineeMode, setNomineeMode] = useState<"character" | "npp">("character");
  const [selectedNppId, setSelectedNppId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [nominateError, setNominateError] = useState("");
  const [votingId, setVotingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/whitehouse/cabinet${countryQuery}`);
      if (!response.ok) {
        setError("Failed to load cabinet data. Please try again.");
        return;
      }
      setData((await response.json()) as CabinetResponse);
    } catch {
      setError("Network error - could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, [countryQuery]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if ((!nominateModal && !actingModal) || !data?.isPresident) return;
    fetch(`/api/whitehouse/cabinet/characters${countryQuery}`)
      .then((response) => (response.ok ? response.json() : { characters: [], npps: [] }))
      .then((json) => {
        const pool = json as { characters?: NomineeOption[]; npps?: NomineeOption[] };
        setCharacters(pool.characters ?? []);
        setNpps(pool.npps ?? []);
      })
      .catch(() => {
        setCharacters([]);
        setNpps([]);
      });
  }, [nominateModal, actingModal, data?.isPresident, countryQuery]);

  // A direct appointment (Chief of Staff) sits as an "active" nomination only
  // until the next turn seats it; it is never a Senate vote.
  const activeNominations = useMemo(
    () =>
      data?.positions.filter(
        (position) =>
          position.nomination?.status === "active" && !position.appointedWithoutConfirmation
      ) ?? [],
    [data]
  );

  const filledCount = data?.positions.filter((position) => position.member).length ?? 0;

  function openNominateModal(positionId = "") {
    setSelectedPositionId(positionId);
    setNominateModal(true);
    setSelectedCharId("");
    setNominateError("");
  }

  function closeNominateModal() {
    setNominateModal(false);
    setSelectedPositionId("");
    setSelectedCharId("");
    setSelectedNppId("");
    setNomineeMode("character");
    setNominateError("");
  }

  /** Open the appointee picker for a seat, in acting mode. */
  function openActingModal(positionId: string) {
    setSelectedPositionId(positionId);
    setActingModal(true);
    setSelectedCharId("");
    setNominateError("");
  }

  function closeActingModal() {
    setActingModal(false);
    setSelectedPositionId("");
    setSelectedCharId("");
    setNominateError("");
  }

  async function handleNominate() {
    const nomineeId = nomineeMode === "npp" ? selectedNppId : selectedCharId;
    if (!selectedPositionId || !nomineeId) {
      setNominateError("Select a position and nominee");
      return;
    }
    setSubmitting(true);
    setNominateError("");
    try {
      const response = await fetch(`/api/whitehouse/cabinet/nominations${countryQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positionId: selectedPositionId,
          ...(nomineeMode === "npp"
            ? { nomineeNppId: nomineeId }
            : { nomineeCharacterId: nomineeId }),
        }),
      });
      const json = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        setNominateError(apiErrorText(json, "Failed to submit nomination"));
        return;
      }
      showToast(json.message ?? "Nomination submitted", "success");
      closeNominateModal();
      await fetchData();
    } catch {
      setNominateError("Network error - please try again");
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Install an acting secretary. Distinct from nominating: the seat is filled
   * at once, without a Senate vote, with full departmental authority.
   * The appointment lapses on its own.
   */
  async function handleAppointActing() {
    if (!selectedPositionId || !selectedCharId) {
      setNominateError("Select a position and an appointee");
      return;
    }
    setSubmitting(true);
    setNominateError("");
    try {
      const response = await fetch(`/api/country/${code}/executive/cabinet/acting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positionId: selectedPositionId,
          characterId: selectedCharId,
        }),
      });
      const json = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        setNominateError(apiErrorText(json, "Failed to appoint an acting secretary"));
        return;
      }
      showToast(json.message ?? "Acting secretary appointed", "success");
      closeActingModal();
      await fetchData();
    } catch {
      setNominateError("Network error - please try again");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVote(nominationId: string, vote: "for" | "against" | "abstain") {
    setVotingId(nominationId);
    try {
      const response = await fetch(
        `/api/whitehouse/cabinet/nominations/${nominationId}/vote${countryQuery}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vote }),
        }
      );
      const json = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        showToast(apiErrorText(json, "Failed to record vote"), "error");
        return;
      }
      showToast(json.message ?? "Vote recorded", "success");
      await fetchData();
    } catch {
      showToast("Network error - please try again", "error");
    } finally {
      setVotingId(null);
    }
  }

  async function handleFire(positionId: string) {
    if (!confirm("Remove this cabinet member?")) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/whitehouse/cabinet/fire${countryQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId }),
      });
      const json = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        showToast(apiErrorText(json, "Failed to remove cabinet member"), "error");
        return;
      }
      showToast(json.message ?? "Cabinet member removed", "success");
      await fetchData();
    } catch {
      showToast("Network error - please try again", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return {
    countryId,
    data,
    loading,
    error,
    fetchData,
    activeNominations,
    filledCount,
    nominateModal,
    actingModal,
    openNominateModal,
    closeNominateModal,
    openActingModal,
    closeActingModal,
    selectedPositionId,
    setSelectedPositionId,
    selectedCharId,
    setSelectedCharId,
    selectedNppId,
    setSelectedNppId,
    nomineeMode,
    setNomineeMode,
    characters,
    npps,
    submitting,
    nominateError,
    votingId,
    handleNominate,
    handleAppointActing,
    handleVote,
    handleFire,
  };
}

export type PresidentialCabinetState = ReturnType<typeof usePresidentialCabinet>;
