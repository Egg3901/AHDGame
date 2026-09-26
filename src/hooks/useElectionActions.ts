import { useState, useCallback } from "react";
import type { ElectionDisplay, CharacterBasic } from "@/lib/db/types";
import { useFeedback } from "@/contexts/FeedbackContext";
import { useToast } from "@/contexts/ToastContext";
import { buildWithdrawalConfirmMessage } from "@/lib/elections/withdrawalWarning";

interface UseElectionActionsProps {
  character: CharacterBasic | null;
  elections: ElectionDisplay[];
  onSuccess?: () => Promise<void>;
}

interface UseElectionActionsReturn {
  actionLoading: string | null;
  message: string;
  setMessage: (msg: string) => void;
  handleEnterRace: (electionId: string) => Promise<void>;
  handleWithdraw: (electionId: string) => Promise<void>;
  isInRace: (election: ElectionDisplay) => boolean;
  isInRaceOfType: (electionType: string, cycle: number) => boolean;
  isInAnyRace: () => boolean;
}

/**
 * Hook for managing election race entry/withdrawal actions.
 * Consolidates duplicate logic from elections page and StateElections component.
 */
export function useElectionActions({
  character,
  elections,
  onSuccess,
}: UseElectionActionsProps): UseElectionActionsReturn {
  const { recordAction } = useFeedback();
  const { showToast } = useToast();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const isInAnyRace = useCallback((): boolean => {
    if (!character) return false;
    if (character.activeElection) return true;
    return elections.some((e) => e.candidates.some((c) => c.characterId === character._id));
  }, [character, elections]);

  const handleEnterRace = useCallback(
    async (electionId: string) => {
      if (!character) {
        setMessage("✗ You need to create a character first");
        return;
      }

      if (isInAnyRace()) {
        const currentRace =
          elections.find((e) => e.candidates.some((c) => c.characterId === character._id)) ??
          (character.activeElection
            ? {
                electionType: character.activeElection.electionType,
                state: character.activeElection.state,
              }
            : null);
        const desc = currentRace
          ? `${currentRace.electionType} race in ${currentRace.state}`
          : "another race";
        setMessage(`✗ You are already running in the ${desc}. Withdraw first.`);
        return;
      }

      const targetRace = elections.find((e) => e.id === electionId);
      const raceName = targetRace
        ? `${targetRace.electionType} race in ${targetRace.state}`
        : "this race";
      if (!confirm(`Enter the ${raceName}? This will register your character as a candidate.`)) {
        return;
      }

      setActionLoading(electionId);
      setMessage("");
      try {
        const res = await fetch(`/api/elections/${electionId}/enter`, {
          method: "POST",
        });
        const data = await res.json();

        if (res.ok) {
          setMessage(`✓ ${data.message}`);
          showToast(data.message);
          recordAction("Entered election", { electionId });
          await onSuccess?.();
        } else {
          setMessage(`✗ ${data.error}`);
          showToast(data.error ?? "Could not enter this race", "error");
        }
      } catch {
        setMessage("✗ Network error");
        showToast("Network error while entering. Please try again.", "error");
      } finally {
        setActionLoading(null);
      }
    },
    [character, elections, isInAnyRace, onSuccess, recordAction, showToast]
  );

  const handleWithdraw = useCallback(
    async (electionId: string) => {
      // Derive election phase so the confirm message can name the right
      // consequence (general-phase withdrawal destroys accumulated votes).
      const targetElection = elections.find((e) => e.id === electionId);
      const phase: "primary" | "general" | "unknown" = targetElection?.inPrimary
        ? "primary"
        : targetElection
          ? "general"
          : "unknown";
      if (!confirm(buildWithdrawalConfirmMessage(phase))) {
        return;
      }

      setActionLoading(electionId);
      setMessage("");
      try {
        const res = await fetch(`/api/elections/${electionId}/withdraw`, {
          method: "POST",
        });
        const data = await res.json();

        if (res.ok) {
          setMessage(`✓ ${data.message}`);
          showToast(data.message);
          recordAction("Withdrew from election", { electionId });
          await onSuccess?.();
        } else {
          setMessage(`✗ ${data.error}`);
          showToast(data.error ?? "Could not withdraw from this race", "error");
        }
      } catch {
        setMessage("✗ Network error");
        showToast("Network error while withdrawing. Please try again.", "error");
      } finally {
        setActionLoading(null);
      }
    },
    [elections, onSuccess, recordAction, showToast]
  );

  const isInRace = useCallback(
    (election: ElectionDisplay): boolean => {
      if (!character) return false;
      if (character.activeElection?.id === election.id) return true;
      return election.candidates.some((c) => c.characterId === character._id);
    },
    [character]
  );

  const isInRaceOfType = useCallback(
    (electionType: string, cycle: number): boolean => {
      if (!character) return false;
      if (
        character.activeElection &&
        character.activeElection.electionType === electionType &&
        character.activeElection.cycle === cycle
      ) {
        return true;
      }
      return elections.some(
        (e) =>
          e.electionType === electionType &&
          e.cycle === cycle &&
          e.candidates.some((c) => c.characterId === character._id)
      );
    },
    [character, elections]
  );

  return {
    actionLoading,
    message,
    setMessage,
    handleEnterRace,
    handleWithdraw,
    isInRace,
    isInRaceOfType,
    isInAnyRace,
  };
}
