"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

import type { OrgSummary, OrgViewerInfo } from "../orgTypes";
import { useEntityName } from "../useEntityName";

interface Props {
  org: OrgSummary;
  viewer: OrgViewerInfo | null;
  onChange: () => void;
}

/**
 * Fund organization: a member raises a national-legislature appropriation bill to
 * send treasury money (local currency) to the org's pooled fund. On the bill's
 * passage the amount is debited and credited (auto-FX to USD) to the fund.
 * Members only.
 */
export function FundOrgPanel({ org, viewer, onChange }: Props) {
  const entityName = useEntityName();
  const viewerFmCountry = viewer?.foreignMinisterOf ?? viewer?.headOfGovernmentOf ?? null;
  const viewerIsMember =
    viewerFmCountry != null && org.members.some((m) => m.countryId === viewerFmCountry);

  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit() {
    if (!viewerFmCountry) return;
    const amountLocal = Number(amount);
    if (!(amountLocal > 0)) {
      setError("Enter a positive amount.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(
        `/api/country/${viewerFmCountry}/international-organizations/${org.id}/fund`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amountLocal }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to propose funding");
      }
      setSuccess("Funding appropriation sent to the legislature.");
      setShowForm(false);
      setAmount("");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to propose funding");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Fund the organization</h3>
          <p className="text-xs text-muted">
            Send treasury money to the pooled fund (auto-converted to the fund&apos;s currency at no
            cost). Raises a national-legislature appropriation bill — members only.
          </p>
        </div>
        {viewerIsMember && viewerFmCountry && (
          <Button
            size="md"
            variant={showForm ? "ghost" : "primary"}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Cancel" : "Fund organization"}
          </Button>
        )}
      </div>

      {showForm && viewerIsMember && viewerFmCountry && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <h4 className="text-sm font-semibold text-foreground">Appropriate funds</h4>
          <div className="mt-3 max-w-xs">
            <label className="text-xs font-medium text-muted" htmlFor="fund-amount">
              Amount ({entityName(viewerFmCountry)} local currency)
            </label>
            <input
              id="fund-amount"
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1000000"
              className="mt-1 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
            />
          </div>
          {error && <p className="mt-2 text-xs text-error">{error}</p>}
          <div className="mt-4 flex gap-2">
            <Button variant="primary" size="md" onClick={submit} isLoading={submitting}>
              Send to the legislature
            </Button>
            <Button variant="ghost" size="md" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {success && <p className="text-xs text-success">{success}</p>}
    </section>
  );
}
