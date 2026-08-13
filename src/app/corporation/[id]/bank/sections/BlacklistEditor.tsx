"use client";

import { useEffect, useReducer } from "react";
import { Button } from "@/components/ui";
import type { ConsolePayload, Party, ShowToast } from "../types";
import { mergeState, partyHref } from "../lib/helpers";
import { PartySearch } from "../components/PartySearch";
import { BlacklistChip } from "../components/BlacklistChip";

export function BlacklistEditor({
  corporationId,
  blacklist,
  availableFunds,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  blacklist: NonNullable<NonNullable<ConsolePayload["charter"]>["blacklist"]>;
  availableFunds: { slug: string; name: string }[];
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const [{ corporations, characters, indexFunds, busy, dirty }, updateBlacklistState] = useReducer(
    mergeState<{
      corporations: Party[];
      characters: Party[];
      indexFunds: { slug: string; name: string }[];
      busy: boolean;
      dirty: boolean;
    }>,
    {
      corporations: blacklist.corporations,
      characters: blacklist.characters,
      indexFunds: blacklist.indexFunds,
      busy: false,
      dirty: false,
    }
  );

  // Re-sync when the console reloads, but never clobber edits in progress.
  useEffect(() => {
    updateBlacklistState({
      corporations: blacklist.corporations,
      characters: blacklist.characters,
      indexFunds: blacklist.indexFunds,
      dirty: false,
    });
  }, [blacklist]);

  const save = async () => {
    updateBlacklistState({ busy: true });
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/blacklist`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          corporationIds: corporations.map((c) => c.id),
          characterIds: characters.map((c) => c.id),
          indexFundIds: indexFunds.map((f) => f.slug),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Could not update blacklist", "error");
        return;
      }
      showToast("Blacklist saved", "success");
      updateBlacklistState({ dirty: false });
      await onChanged();
    } finally {
      updateBlacklistState({ busy: false });
    }
  };

  const total = corporations.length + characters.length + indexFunds.length;

  return (
    <section className="space-y-4 rounded-xl border border-card-border bg-card p-5">
      <div>
        <h3 className="text-base font-semibold text-foreground">Who this bank refuses</h3>
        <p className="mt-1 text-sm text-muted">
          Listed players cannot deposit here or borrow from you. Listed companies cannot borrow.
          Listing an index fund refuses every company in it. Nobody sees this list except you.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Players ({characters.length})
          </h4>
          {canMutate && (
            <PartySearch
              kind="character"
              excludeIds={characters.map((c) => c.id)}
              disabled={busy}
              onPick={(party) =>
                updateBlacklistState({ characters: [...characters, party], dirty: true })
              }
            />
          )}
          <div className="flex flex-wrap gap-2">
            {characters.length === 0 ? (
              <p className="text-xs text-muted">No players refused.</p>
            ) : (
              characters.map((party) => (
                <BlacklistChip
                  key={party.id}
                  label={party.name}
                  href={partyHref("character", party)}
                  canMutate={canMutate}
                  onRemove={() =>
                    updateBlacklistState({
                      characters: characters.filter((c) => c.id !== party.id),
                      dirty: true,
                    })
                  }
                />
              ))
            )}
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Companies ({corporations.length})
          </h4>
          {canMutate && (
            <PartySearch
              kind="corporation"
              excludeIds={corporations.map((c) => c.id)}
              disabled={busy}
              onPick={(party) =>
                updateBlacklistState({ corporations: [...corporations, party], dirty: true })
              }
            />
          )}
          <div className="flex flex-wrap gap-2">
            {corporations.length === 0 ? (
              <p className="text-xs text-muted">No companies refused.</p>
            ) : (
              corporations.map((party) => (
                <BlacklistChip
                  key={party.id}
                  label={party.ticker ? `${party.name} (${party.ticker})` : party.name}
                  href={partyHref("corporation", party)}
                  canMutate={canMutate}
                  onRemove={() =>
                    updateBlacklistState({
                      corporations: corporations.filter((c) => c.id !== party.id),
                      dirty: true,
                    })
                  }
                />
              ))
            )}
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Index funds ({indexFunds.length})
          </h4>
          {canMutate && (
            <select
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground"
              value=""
              disabled={busy}
              aria-label="Add an index fund to the blacklist"
              onChange={(e) => {
                const fund = availableFunds.find((f) => f.slug === e.target.value);
                if (fund) {
                  updateBlacklistState({ indexFunds: [...indexFunds, fund], dirty: true });
                }
              }}
            >
              <option value="">Add a fund...</option>
              {availableFunds
                .filter((f) => !indexFunds.some((picked) => picked.slug === f.slug))
                .map((fund) => (
                  <option key={fund.slug} value={fund.slug}>
                    {fund.name}
                  </option>
                ))}
            </select>
          )}
          <div className="flex flex-wrap gap-2">
            {indexFunds.length === 0 ? (
              <p className="text-xs text-muted">No funds refused.</p>
            ) : (
              indexFunds.map((fund) => (
                <BlacklistChip
                  key={fund.slug}
                  label={fund.name}
                  canMutate={canMutate}
                  onRemove={() =>
                    updateBlacklistState({
                      indexFunds: indexFunds.filter((f) => f.slug !== fund.slug),
                      dirty: true,
                    })
                  }
                />
              ))
            )}
          </div>
        </div>
      </div>

      {canMutate && (
        <div className="flex items-center gap-3">
          <Button type="button" onClick={() => void save()} disabled={busy || !dirty}>
            {busy ? "Saving..." : "Save blacklist"}
          </Button>
          <span className="text-xs text-muted">
            {dirty ? "Unsaved changes" : `${total} ${total === 1 ? "entry" : "entries"}`}
          </span>
        </div>
      )}
    </section>
  );
}
