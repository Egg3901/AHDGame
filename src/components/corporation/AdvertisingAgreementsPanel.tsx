"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Input } from "@/components/ui";
import { apiErrorText } from "@/lib/errors/catalog";

interface AgreementRow {
  id: string;
  role: "buyer" | "supplier";
  status: string;
  allocationShareBps: number;
  durationTurns?: number;
  lastEffectiveAnchor?: number;
  lastOverlap?: number;
  counterparty?: { id: string; name: string; ticker?: string };
}

/**
 * Coverage advertising is a media product. Media corporations supply it, so
 * they always see the full panel. Any other corporation is only ever a buyer:
 * it sees its live agreements, and otherwise a collapsed entry point instead
 * of a media workflow sitting open on its sectors tab.
 */
export default function AdvertisingAgreementsPanel({
  corpId,
  ownsMediaSector = true,
}: {
  corpId: string;
  ownsMediaSector?: boolean;
}) {
  const [agreements, setAgreements] = useState<AgreementRow[]>([]);
  const [supplierCorpId, setSupplierCorpId] = useState("");
  const [sharePct, setSharePct] = useState("10");
  const [durationTurns, setDurationTurns] = useState("24");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/corporations/${corpId}/advertising-agreements`);
    if (!response.ok) return;
    const data = (await response.json()) as { agreements?: AgreementRow[] };
    setAgreements(data.agreements ?? []);
  }, [corpId]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/corporations/${corpId}/advertising-agreements`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { agreements?: AgreementRow[] };
        setAgreements(data.agreements ?? []);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setNotice("Could not load advertising agreements");
        }
      });
    return () => controller.abort();
  }, [corpId]);

  async function propose(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    const response = await fetch(`/api/corporations/${corpId}/advertising-agreements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierCorpId: supplierCorpId.trim(),
        allocationShareBps: Math.round(Number(sharePct) * 100),
        durationTurns: Number(durationTurns),
      }),
    });
    const data = await response.json();
    setNotice(response.ok ? "Advertising proposal sent" : apiErrorText(data, "Proposal failed"));
    if (response.ok) {
      setSupplierCorpId("");
      await refresh();
    }
    setBusy(false);
  }

  async function update(id: string, action: "accept" | "cancel") {
    setBusy(true);
    setNotice("");
    const response = await fetch(`/api/corporations/${corpId}/advertising-agreements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await response.json();
    setNotice(response.ok ? `Agreement ${action}ed` : apiErrorText(data, `${action} failed`));
    if (response.ok) await refresh();
    setBusy(false);
  }

  const content = (
    <>
      <p className="text-sm text-muted">
        Allocate part of the existing marketing budget to a Media & Entertainment supplier. This
        does not add a second expense; delivered coverage changes advertising efficacy.
      </p>
      {notice && (
        <p className="mt-2 text-sm text-muted" role="status">
          {notice}
        </p>
      )}
      <form className="mt-3 grid gap-2 sm:grid-cols-4" onSubmit={(event) => void propose(event)}>
        <Input
          aria-label="Advertising supplier corporation ID"
          placeholder="Supplier corporation ID"
          value={supplierCorpId}
          onChange={(event) => setSupplierCorpId(event.target.value)}
          required
        />
        <Input
          aria-label="Marketing budget share percent"
          type="number"
          min="1"
          max="100"
          value={sharePct}
          onChange={(event) => setSharePct(event.target.value)}
        />
        <Input
          aria-label="Agreement duration turns"
          type="number"
          min="4"
          max="192"
          value={durationTurns}
          onChange={(event) => setDurationTurns(event.target.value)}
        />
        <Button type="submit" size="sm" isLoading={busy}>
          Propose agreement
        </Button>
      </form>
      <ul className="mt-4 space-y-2" aria-label="Advertising agreements">
        {agreements.map((agreement) => (
          <li key={agreement.id} className="rounded-lg border border-card-border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {agreement.counterparty?.name ?? agreement.counterparty?.id ?? "Counterparty"}
              </span>
              <Badge color="info">{agreement.role}</Badge>
              <Badge color={agreement.status === "active" ? "success" : "default"}>
                {agreement.status}
              </Badge>
              <span>{agreement.allocationShareBps / 100}% of budget</span>
            </div>
            {agreement.lastOverlap !== undefined && (
              <p className="mt-1 text-xs text-muted">
                Last coverage overlap {Math.round(agreement.lastOverlap * 100)}%; effective value{" "}
                {Math.round(agreement.lastEffectiveAnchor ?? 0)}
              </p>
            )}
            <div className="mt-2 flex gap-2">
              {agreement.status === "pending" && agreement.role === "supplier" && (
                <Button
                  size="sm"
                  onClick={() => void update(agreement.id, "accept")}
                  disabled={busy}
                >
                  Accept
                </Button>
              )}
              {(agreement.status === "active" || agreement.status === "cancelling") && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void update(agreement.id, "cancel")}
                  disabled={busy}
                >
                  Cancel
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );

  if (!ownsMediaSector && agreements.length === 0) {
    return (
      <Card>
        <details>
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Buy coverage advertising from a media corporation
          </summary>
          <div className="mt-3">{content}</div>
        </details>
      </Card>
    );
  }

  return <Card title="Coverage advertising">{content}</Card>;
}
