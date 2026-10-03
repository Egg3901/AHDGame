"use client";

import { useEffect, useReducer, type ReactNode } from "react";
import type { ConsolePayload, Party, ShowToast } from "../types";
import { mergeState, partyHref } from "../lib/helpers";
import { PartySearch } from "../components/PartySearch";
import { BlacklistChip } from "../components/BlacklistChip";
import { SmallButton } from "@/components/corporation/dense/DenseKit";
import { BankPanel } from "../components/BankSection";

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
      const entryCount = corporations.length + characters.length + indexFunds.length;
      showToast(
        `Refusal list saved: ${entryCount} ${entryCount === 1 ? "entry" : "entries"}. Listed players cannot deposit or borrow; listed companies cannot borrow.`,
        "success"
      );
      updateBlacklistState({ dirty: false });
      await onChanged();
    } finally {
      updateBlacklistState({ busy: false });
    }
  };

  const total = corporations.length + characters.length + indexFunds.length;

  const column = (heading: string, count: number, control: ReactNode, list: ReactNode) => (
    <div className="min-w-0 space-y-1.5">
      <h3 className="text-xs font-medium text-muted">
        {heading} <span className="font-mono">({count})</span>
      </h3>
      {control}
      {list}
    </div>
  );

  return (
    <BankPanel
      kind="ceoControl"
      title="Who this bank refuses"
      actions={
        canMutate ? (
          <>
            <span className="text-xs text-muted">
              {dirty ? "Unsaved changes" : `${total} ${total === 1 ? "entry" : "entries"}`}
            </span>
            <SmallButton tone="primary" onClick={() => void save()} disabled={busy || !dirty}>
              {busy ? "Saving..." : "Save blacklist"}
            </SmallButton>
          </>
        ) : undefined
      }
    >
      <p className="py-1.5 text-xs text-muted">
        Listed players cannot deposit here or borrow from you. Listed companies cannot borrow.
        Listing an index fund refuses every company in it. Nobody sees this list except you.
      </p>

      <div className="grid gap-x-8 gap-y-4 pt-1 lg:grid-cols-3">
        {column(
          "Players",
          characters.length,
          canMutate ? (
            <PartySearch
              kind="character"
              excludeIds={characters.map((c) => c.id)}
              disabled={busy}
              onPick={(party) =>
                updateBlacklistState({ characters: [...characters, party], dirty: true })
              }
            />
          ) : null,
          characters.length === 0 ? (
            <p className="text-xs text-muted">No players refused.</p>
          ) : (
            <ul>
              {characters.map((party) => (
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
              ))}
            </ul>
          )
        )}

        {column(
          "Companies",
          corporations.length,
          canMutate ? (
            <PartySearch
              kind="corporation"
              excludeIds={corporations.map((c) => c.id)}
              disabled={busy}
              onPick={(party) =>
                updateBlacklistState({ corporations: [...corporations, party], dirty: true })
              }
            />
          ) : null,
          corporations.length === 0 ? (
            <p className="text-xs text-muted">No companies refused.</p>
          ) : (
            <ul>
              {corporations.map((party) => (
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
              ))}
            </ul>
          )
        )}

        {column(
          "Index funds",
          indexFunds.length,
          canMutate ? (
            <select
              className="h-8 w-full rounded-md border border-card-border bg-background px-2 text-[13px] text-foreground focus:border-foreground focus:outline-none"
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
          ) : null,
          indexFunds.length === 0 ? (
            <p className="text-xs text-muted">No funds refused.</p>
          ) : (
            <ul>
              {indexFunds.map((fund) => (
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
              ))}
            </ul>
          )
        )}
      </div>
    </BankPanel>
  );
}
