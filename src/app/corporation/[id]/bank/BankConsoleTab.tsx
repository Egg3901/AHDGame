"use client";

import { useCallback, useEffect, useReducer } from "react";
import { Skeleton } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import type { ConsolePayload } from "./types";
import { mergeState } from "./lib/helpers";
import { ActiveCharterPanel } from "./sections/ActiveCharterPanel";
import { CapsPanel } from "./sections/CapsPanel";
import { CharterIssueForm } from "./sections/CharterIssueForm";

interface Props {
  corporationId: string;
  isCeo: boolean;
}

interface ConsoleLoadState {
  data: ConsolePayload | null;
  loading: boolean;
  error: string | null;
}

export function BankConsoleTab({ corporationId, isCeo }: Props) {
  const { showToast } = useToast();
  const [{ data, loading, error }, updateLoadState] = useReducer(mergeState<ConsoleLoadState>, {
    data: null,
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    updateLoadState({ loading: true });
    try {
      const res = await fetch(`/api/banking/corporation/${corporationId}`);
      const json = (await res.json().catch(() => ({}))) as ConsolePayload & { error?: string };
      if (!res.ok) {
        updateLoadState({
          error: json.error ?? "Failed to load bank console",
          data: null,
        });
        return;
      }
      updateLoadState({ error: null, data: json });
    } catch {
      updateLoadState({ error: "Failed to load bank console", data: null });
    } finally {
      updateLoadState({ loading: false });
    }
  }, [corporationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <p role="alert" className="py-2 text-xs text-error">
        Bank console unavailable{error ? `: ${error}` : "."}
      </p>
    );
  }

  if (!data.visible) {
    return (
      <p className="py-2 text-xs text-muted">
        No bank console. Own a financial sector to charter a bank, or open a corporation that
        already holds a charter.
      </p>
    );
  }

  const canMutate = data.canMutate && isCeo;
  // Why the actions are off matters to the player. `canMutate` folds two very
  // different reasons together (not CEO / banking frozen), and the panels used
  // to blame the CEO check for both, telling a sitting CEO they were not the
  // CEO during a freeze.
  const blockReason = canMutate
    ? null
    : !isCeo || !data.isCeo
      ? "Only the CEO can issue a charter."
      : "Bank actions are paused while private banking is frozen.";

  return (
    <div className="space-y-6">
      {!data.privateBankingEnabled && (
        <p role="status" className="text-xs text-warning">
          Private banking is frozen. You can view this console, but bank actions are disabled.
        </p>
      )}

      {data.charter ? (
        <>
          <ActiveCharterPanel
            data={data}
            canMutate={canMutate}
            onChanged={load}
            showToast={showToast}
          />
          <CapsPanel data={data} />
        </>
      ) : (
        <CharterIssueForm
          data={data}
          canMutate={canMutate}
          blockReason={blockReason}
          onChanged={load}
          showToast={showToast}
        />
      )}
    </div>
  );
}
