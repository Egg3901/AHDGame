"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, LoadingSpinner } from "@/components/ui";

interface Offer {
  revision: number;
  proposedBy: "union" | "employer";
  wageLevel: number;
  agreementDurationTurns: number;
  noStrikeTurns: number;
  /** A8: share of the covered wage bill. Absent means the offer asks for none. */
  pensionContributionRate?: number;
  proposedAtTurn: number;
}

interface Campaign {
  campaignId: string;
  unionId: string;
  unionName: string;
  status: "negotiating" | "dispute" | "settled" | "withdrawn" | "lapsed";
  escalationLevel: "none" | "overtime_ban" | "selective_strike" | "industry_strike";
  mediation: {
    wageLevel: number;
    agreementDurationTurns: number;
    noStrikeTurns: number;
    pensionContributionRate?: number;
    unionAccepted: boolean;
    employerAccepted: boolean;
    status: "pending" | "rejected" | "expired";
    expiresAtTurn: number;
  } | null;
  mediationAvailable: boolean;
  mediationUnavailableReason: string | null;
  /**
   * The union's members are voting on the employer's offer. Status and the
   * closing turn only: how the ballot is going is a union-internal fact, but
   * that an answer is coming, and when, is something the party waiting on the
   * answer has to know.
   */
  ratification: {
    status: "open" | "ratified" | "rejected" | "void";
    offerRevision: number;
    openedAtTurn: number;
    closesAtTurn: number;
  } | null;
  currentOffer: Offer;
  offers: Offer[];
  /**
   * What the employer is allowed to read of the union's mandate. Coverage,
   * grievance, the labour market and the law are all things an employer can
   * observe: it counts the union cards in its own plants, sets the wages the
   * grievance is measured against, and lives under the same labour market and
   * statute book. `support` and `strikeFundRunway` are deliberately not sent
   * to this surface: the strike ballot and the size of the union's treasury
   * are internal union facts, and an employer that could read the fund exactly
   * would know precisely how long to sit out any dispute.
   */
  mandate: {
    leverage: number;
    coverage: number;
    grievance: number;
    laborTightness: number;
    lawSupport: number;
  };
  sectorCount: number;
  deadlineTurn: number;
  mediationAvailableTurn: number;
}

interface Agreement {
  agreementId: string;
  unionId: string;
  unionName: string;
  wageLevel: number;
  sectorCount: number;
  expiresAtTurn: number;
  noStrikeUntilTurn: number;
}

interface Draft {
  wageLevel: string;
  agreementDurationTurns: string;
  noStrikeTurns: string;
  /** Percent in the field, fraction on the wire. Nobody bargains in decimals. */
  pensionPercent: string;
}

export default function IndustrialRelationsSection({ corpId }: { corpId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [currentTurn, setCurrentTurn] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/corporations/${corpId}/bargaining`);
      if (!response.ok) {
        if (response.status === 403) {
          setEnabled(false);
          return;
        }
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setLoadError(data?.error ?? "Industrial relations could not be loaded.");
        return;
      }
      const data = (await response.json()) as {
        campaigns: Campaign[];
        agreements: Agreement[];
        currentTurn: number;
      };
      setEnabled(true);
      setCampaigns(data.campaigns);
      setAgreements(data.agreements);
      setCurrentTurn(data.currentTurn);
      setDrafts((current) => {
        const next = { ...current };
        for (const campaign of data.campaigns) {
          next[campaign.campaignId] ??= {
            wageLevel: String(campaign.currentOffer.wageLevel),
            agreementDurationTurns: String(campaign.currentOffer.agreementDurationTurns),
            noStrikeTurns: String(campaign.currentOffer.noStrikeTurns),
            pensionPercent: String(
              ((campaign.currentOffer.pensionContributionRate ?? 0) * 100).toFixed(1)
            ),
          };
        }
        return next;
      });
    } catch {
      setLoadError("Network error. Industrial relations could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [corpId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(
    campaignId: string,
    action:
      | "accept"
      | "counter"
      | "reject"
      | "request_mediation"
      | "accept_mediation"
      | "reject_mediation"
  ) {
    setPendingId(campaignId);
    setMessage(null);
    const draft = drafts[campaignId];
    const body =
      action === "counter"
        ? {
            action,
            wageLevel: Number(draft?.wageLevel),
            agreementDurationTurns: Number(draft?.agreementDurationTurns),
            noStrikeTurns: Number(draft?.noStrikeTurns),
            pensionContributionRate: Number(draft?.pensionPercent ?? 0) / 100,
          }
        : { action };
    try {
      const response = await fetch(`/api/corporations/${corpId}/bargaining/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      setMessage({
        ok: response.ok,
        text: response.ok ? "Bargaining response recorded." : (data.error ?? "Action failed."),
      });
      if (response.ok) await load();
    } catch {
      setMessage({ ok: false, text: "Network error. No bargaining action was recorded." });
    } finally {
      setPendingId(null);
    }
  }

  const openCampaigns = campaigns.filter(
    (campaign) => campaign.status === "negotiating" || campaign.status === "dispute"
  );

  if (enabled === false) return null;

  if (loading) {
    return (
      <section
        aria-label="Industrial Relations"
        className="rounded-xl border border-card-border bg-card p-5"
      >
        <LoadingSpinner label="Loading industrial relations..." centered />
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="rounded-xl border border-error/30 bg-error/10 p-5">
        <h3 className="text-heading-sm font-semibold text-foreground">Industrial Relations</h3>
        <p role="alert" className="mt-1 text-body text-error">
          {loadError}
        </p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => void load()}>
          Try again
        </Button>
      </section>
    );
  }

  if (enabled !== true) return null;

  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-5">
      <div>
        <h3 className="text-heading-sm font-semibold text-foreground">Industrial Relations</h3>
        <p className="mt-1 text-body text-muted">
          Negotiate wage floors and labour peace with the unions representing your operating sectors.
        </p>
      </div>

      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-body font-medium ${
            message.ok
              ? "border-success/30 bg-success/10 text-success"
              : "border-error/30 bg-error/10 text-error"
          }`}
        >
          <span aria-hidden>{message.ok ? "✓" : "⚠"}</span>
          <span>{message.text}</span>
        </p>
      )}

      {openCampaigns.length === 0 ? (
        <p className="text-body text-muted">No open bargaining campaigns.</p>
      ) : (
        <div className="space-y-4">
          {openCampaigns.map((campaign) => {
            const offer = campaign.currentOffer;
            const draft = drafts[campaign.campaignId];
            const canAccept =
              (campaign.status === "negotiating" || campaign.status === "dispute") &&
              offer.proposedBy === "union";
            // A dispute stays answerable: industrial action is pressure to
            // move the package, so the employer must be able to table a better
            // one without waiting for the union to fold.
            const canCounter =
              (campaign.status === "negotiating" || campaign.status === "dispute") &&
              offer.proposedBy === "union";
            const mediation = campaign.mediation;
            return (
              <article
                key={campaign.campaignId}
                className="rounded-lg border border-card-border bg-card-elevated p-4 space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/unions/${campaign.unionId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {campaign.unionName}
                    </Link>
                    <p className="text-body-sm text-muted">
                      {campaign.sectorCount} local(s) · Deadline turn {campaign.deadlineTurn} · Turn{" "}
                      {currentTurn}
                    </p>
                  </div>
                  <span className="rounded-full bg-warning/15 px-2.5 py-1 text-body-sm font-semibold text-warning">
                    {campaign.status === "dispute" ? "Dispute" : `Offer ${offer.revision}`}
                  </span>
                </div>

                {campaign.ratification?.status === "open" && (
                  <p className="rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-body-sm text-info">
                    The union has put offer {campaign.ratification.offerRevision} to its members.
                    They vote through turn {campaign.ratification.closesAtTurn}.
                  </p>
                )}
                {campaign.ratification?.status === "rejected" && (
                  <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-body-sm text-warning">
                    Union members rejected offer {campaign.ratification.offerRevision}.
                  </p>
                )}

                {/* Five metrics: three across at sm so the row never leaves one
                    orphan, five across once there is width for it. */}
                <div className="grid grid-cols-2 gap-3 text-body sm:grid-cols-3 lg:grid-cols-5">
                  <Metric label="Wage floor" value={`${offer.wageLevel.toFixed(2)}×`} />
                  <Metric label="Agreement" value={`${offer.agreementDurationTurns} turns`} />
                  <Metric label="Labour peace" value={`${offer.noStrikeTurns} turns`} />
                  <Metric
                    label="Pension"
                    value={
                      offer.pensionContributionRate
                        ? `${(offer.pensionContributionRate * 100).toFixed(1)}% of pay`
                        : "None"
                    }
                  />
                  <Metric
                    label="Union leverage"
                    value={campaign.mandate.leverage.toFixed(0)}
                  />
                </div>

                <details className="rounded-lg bg-card px-3 py-2 text-body">
                  <summary className="cursor-pointer font-medium text-foreground">
                    What is behind their leverage
                  </summary>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Metric label="Coverage" value={campaign.mandate.coverage.toFixed(0)} />
                    <Metric label="Grievance" value={campaign.mandate.grievance.toFixed(0)} />
                    <Metric
                      label="Labour market"
                      value={campaign.mandate.laborTightness.toFixed(0)}
                    />
                    <Metric label="Labour law" value={campaign.mandate.lawSupport.toFixed(0)} />
                  </div>
                  <p className="mt-2 text-body-sm text-muted">
                    Recomputed every turn from live conditions: how organized your locals are, the
                    gap between the pay you set and what workers expect, how scarce labour is
                    nationally, and what the law gives collective bargaining. The union&apos;s strike
                    fund is not visible to you.
                  </p>
                </details>

                {campaign.offers.length > 1 && (
                  <details className="rounded-lg bg-card px-3 py-2 text-body">
                    <summary className="cursor-pointer font-medium text-foreground">
                      Offer history ({campaign.offers.length})
                    </summary>
                    <ol className="mt-2 space-y-1 text-body-sm text-muted">
                      {campaign.offers.map((pastOffer) => (
                        <li key={pastOffer.revision}>
                          #{pastOffer.revision} {pastOffer.proposedBy}:{" "}
                          {pastOffer.wageLevel.toFixed(2)}× wage, {pastOffer.agreementDurationTurns}{" "}
                          turns, {pastOffer.noStrikeTurns} no-strike
                        </li>
                      ))}
                    </ol>
                  </details>
                )}

                {campaign.status === "dispute" && (
                  <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-3">
                    <p className="text-body-sm text-muted">
                      Industrial action: {campaign.escalationLevel.replaceAll("_", " ")}
                    </p>
                    {mediation ? (
                      <div className="rounded-lg bg-card p-3 text-body">
                        <p className="font-medium text-foreground">
                          Mediation package: {mediation.wageLevel.toFixed(2)}× wage,{" "}
                          {mediation.agreementDurationTurns} turns, {mediation.noStrikeTurns}{" "}
                          no-strike
                        </p>
                        <p className="mt-1 text-body-sm text-muted">
                          {mediation.status === "pending"
                            ? `Open through turn ${mediation.expiresAtTurn}. Union ${mediation.unionAccepted ? "accepted" : "pending"}; employer ${mediation.employerAccepted ? "accepted" : "pending"}.`
                            : `Mediation ${mediation.status}.`}
                        </p>
                        {mediation.status === "pending" && !mediation.employerAccepted && (
                          <div className="mt-3 flex gap-2">
                            <Button
                              size="sm"
                              className="bg-success hover:bg-success-muted"
                              disabled={pendingId === campaign.campaignId}
                              onClick={() => void act(campaign.campaignId, "accept_mediation")}
                            >
                              Accept mediation
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="border-error/40 text-error hover:border-error/60 hover:text-error"
                              disabled={pendingId === campaign.campaignId}
                              onClick={() => void act(campaign.campaignId, "reject_mediation")}
                            >
                              Reject mediation
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : campaign.mediationAvailable ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="border-primary/40 text-primary hover:border-primary/60 hover:text-primary"
                        disabled={pendingId === campaign.campaignId}
                        onClick={() => void act(campaign.campaignId, "request_mediation")}
                      >
                        Request mediation
                      </Button>
                    ) : campaign.mediationUnavailableReason ? (
                      <p className="text-body-sm text-muted">
                        {campaign.mediationUnavailableReason}
                      </p>
                    ) : null}
                  </div>
                )}

                {canAccept ? (
                  <div className="space-y-3">
                    {canCounter && (
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Field
                          label="Counter wage"
                          value={draft?.wageLevel ?? ""}
                          step="0.01"
                          min="0.8"
                          max="1.5"
                          onChange={(value) =>
                            setDrafts((all) => ({
                              ...all,
                              [campaign.campaignId]: { ...draft, wageLevel: value } as Draft,
                            }))
                          }
                        />
                        <Field
                          label="Agreement turns"
                          value={draft?.agreementDurationTurns ?? ""}
                          step="1"
                          min="24"
                          max="192"
                          onChange={(value) =>
                            setDrafts((all) => ({
                              ...all,
                              [campaign.campaignId]: {
                                ...draft,
                                agreementDurationTurns: value,
                              } as Draft,
                            }))
                          }
                        />
                        <Field
                          label="No-strike turns"
                          value={draft?.noStrikeTurns ?? ""}
                          step="1"
                          min="0"
                          max={draft?.agreementDurationTurns ?? "192"}
                          onChange={(value) =>
                            setDrafts((all) => ({
                              ...all,
                              [campaign.campaignId]: { ...draft, noStrikeTurns: value } as Draft,
                            }))
                          }
                        />
                        <Field
                          label="Pension %"
                          value={draft?.pensionPercent ?? "0"}
                          step="0.5"
                          min="0"
                          max="15"
                          onChange={(value) =>
                            setDrafts((all) => ({
                              ...all,
                              [campaign.campaignId]: { ...draft, pensionPercent: value } as Draft,
                            }))
                          }
                        />
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="bg-success hover:bg-success-muted"
                        disabled={pendingId === campaign.campaignId}
                        onClick={() => void act(campaign.campaignId, "accept")}
                      >
                        Accept offer
                      </Button>
                      {canCounter && (
                        <>
                          <Button
                            size="sm"
                            disabled={pendingId === campaign.campaignId}
                            onClick={() => void act(campaign.campaignId, "counter")}
                          >
                            Send counteroffer
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="border-error/40 text-error hover:border-error/60 hover:text-error"
                            disabled={pendingId === campaign.campaignId}
                            onClick={() => void act(campaign.campaignId, "reject")}
                          >
                            Reject into dispute
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-body text-muted">
                    {campaign.status === "dispute"
                      ? "Negotiations are in dispute. The union must answer the current employer offer or withdraw."
                      : "Your counteroffer is awaiting the union's response."}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}

      {agreements.length > 0 && (
        <div className="border-t border-card-border pt-4">
          <h4 className="mb-3 text-heading-sm font-semibold text-foreground">Active agreements</h4>
          <div className="space-y-2">
            {agreements.map((agreement) => (
              <div
                key={agreement.agreementId}
                className="flex flex-wrap justify-between gap-2 rounded-lg bg-card-elevated px-3 py-2 text-body"
              >
                <span>
                  <Link
                    href={`/unions/${agreement.unionId}`}
                    className="text-primary hover:underline"
                  >
                    {agreement.unionName}
                  </Link>
                  : {agreement.sectorCount} local(s) at {agreement.wageLevel.toFixed(2)}×
                </span>
                <span className="text-muted">
                  Expires turn {agreement.expiresAtTurn} · No strike through turn{" "}
                  {agreement.noStrikeUntilTurn}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-body-sm text-muted">{label}</div>
      <div className="font-mono font-semibold text-foreground">{value}</div>
    </div>
  );
}

function Field({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  step: string;
  min: string;
  max: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-body-sm text-muted">
      {label}
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-body text-foreground"
      />
    </label>
  );
}
