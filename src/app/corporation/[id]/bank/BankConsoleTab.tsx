"use client";

import { useCallback, useEffect, useReducer } from "react";
import { EmptyState, Skeleton } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import type { ConsolePayload } from "./types";
import { mergeState } from "./lib/helpers";
import { ActiveCharterPanel } from "./sections/ActiveCharterPanel";
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
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !data) {
    return <EmptyState title="Bank console unavailable" description={error ?? undefined} />;
  }

  if (!data.visible) {
    return (
      <EmptyState
        title="No bank console"
        description="Own a financial sector to charter a bank, or open a corp that already holds a charter."
      />
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
    <div className="space-y-8">
      {!data.privateBankingEnabled && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Private banking is frozen. You can view this console, but bank actions are disabled.
        </div>
      )}

      {data.charter ? (
        <ActiveCharterPanel
          data={data}
          canMutate={canMutate}
          onChanged={load}
          showToast={showToast}
        />
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
