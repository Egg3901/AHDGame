"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DeliverAddressModal } from "./address/DeliverAddressModal";
import { turnoutTargetLabel } from "@/lib/demographics/turnoutTarget";
import {
  getNationalAddressName,
  getRegionalAddressName,
  type CountryId,
} from "@/lib/constants/countries";
import { ADDRESS_ACTION_COST } from "@/lib/constants/governorOffice";

export interface MostRecentAddressSummary {
  deliveredAtTurn: number;
  deliveredByName: string;
  title: string | null;
  body: string | null;
  emphasizedCategories: string[];
  targetDemographicGroupId: string | null;
  approvalEffect: { amount: number; expiresAtTurn: number };
  agendaEffect: { expiresAtTurn: number } | null;
  demographicEffect: { turnoutDelta: number; expiresAtTurn: number } | null;
}

interface Props {
  countryId: CountryId;
  stateId: string;
  mostRecentAddress: MostRecentAddressSummary | null;
  addressAvailableAtTurn: number;
  currentTurn: number;
  viewerIsHolder: boolean;
  gubernatorialActions: number;
  /** Defaults to "state". When "national", uses getNationalAddressName for the
   *  title and points the modal at the federal endpoint. */
  scope?: "state" | "national";
  /** When true, surfaces an admin-override banner that bypasses AP/NPI. */
  viewerIsAdmin?: boolean;
  /** Optional callback invoked after a successful delivery, in addition to
   *  router.refresh(). Used by lazy-fetched parents (e.g. WhiteHouseAddressTab)
   *  to re-pull their client-side state — router.refresh() alone doesn't
   *  re-trigger useEffect-based fetches. */
  onAddressDelivered?: () => void;
}

export function AddressTab(props: Props) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const isNational = props.scope === "national";
  const addressName = isNational
    ? getNationalAddressName(props.countryId)
    : getRegionalAddressName(props.countryId);
  const onCooldown = props.currentTurn < props.addressAvailableAtTurn;
  const canAffordAp = props.gubernatorialActions >= ADDRESS_ACTION_COST;
  const canDeliver = props.viewerIsHolder && !onCooldown && canAffordAp;
  const disabledReason = !props.viewerIsHolder
    ? "Office-holder only."
    : onCooldown
      ? "Cooldown active."
      : !canAffordAp
        ? `Need ${ADDRESS_ACTION_COST} office AP.`
        : "";
  const showAdminBanner = !!props.viewerIsAdmin && !props.viewerIsHolder;

  return (
    <div className="space-y-4">
      {showAdminBanner && (
        <div className="rounded-xl border border-error/40 bg-error/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Admin &mdash; deliver {addressName} on behalf of the sitting leader
              </p>
              <p className="mt-0.5 text-xs text-muted">
                Bypasses Office AP + NPI checks. Used for testing or correcting state.
              </p>
            </div>
            <button
              onClick={() => {
                setAdminMode(true);
                setModalOpen(true);
              }}
              disabled={onCooldown}
              className="shrink-0 rounded-lg bg-error px-3 py-1.5 text-sm font-medium text-white hover:bg-error/80 disabled:opacity-50"
              title={onCooldown ? "Cooldown active." : ""}
            >
              Admin deliver
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-card-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">{addressName}</h2>
            <p className="text-xs text-muted mt-0.5">
              {onCooldown
                ? `Available again in ${props.addressAvailableAtTurn - props.currentTurn} turns`
                : "Available now"}
            </p>
          </div>
          <button
            onClick={() => {
              setAdminMode(false);
              setModalOpen(true);
            }}
            disabled={!canDeliver}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/80 disabled:opacity-50"
            title={disabledReason}
          >
            Deliver
          </button>
        </div>
      </div>

      {props.mostRecentAddress && (
        <div className="rounded-xl border border-card-border bg-card p-5 space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-muted">Most recent</h3>
          {props.mostRecentAddress.title && (
            <p className="text-base font-semibold">{props.mostRecentAddress.title}</p>
          )}
          <p className="text-sm text-muted">
            Delivered {props.currentTurn - props.mostRecentAddress.deliveredAtTurn} turns ago by{" "}
            {props.mostRecentAddress.deliveredByName}
          </p>
          {props.mostRecentAddress.body && (
            <p className="text-sm italic whitespace-pre-wrap text-foreground/90 border-l-2 border-card-border pl-3">
              {props.mostRecentAddress.body}
            </p>
          )}
          <div className="flex flex-wrap gap-2 text-xs">
            {props.mostRecentAddress.emphasizedCategories.map((c) => (
              <span
                key={c}
                className="rounded-full bg-card-border/40 px-2 py-0.5 capitalize text-muted"
              >
                {c}
              </span>
            ))}
            {props.mostRecentAddress.targetDemographicGroupId && (
              <span className="rounded-full bg-info/15 px-2 py-0.5 text-info">
                Target:{" "}
                {turnoutTargetLabel(
                  props.mostRecentAddress.targetDemographicGroupId,
                  props.countryId
                )}
              </span>
            )}
          </div>
          <EffectsStatus mostRecent={props.mostRecentAddress} currentTurn={props.currentTurn} />
        </div>
      )}

      <DeliverAddressModal
        open={modalOpen}
        countryId={props.countryId}
        stateId={props.stateId}
        gubernatorialActions={props.gubernatorialActions}
        scope={props.scope}
        adminOverride={adminMode}
        onClose={() => {
          setModalOpen(false);
          setAdminMode(false);
        }}
        onSuccess={() => {
          setModalOpen(false);
          setAdminMode(false);
          router.refresh();
          props.onAddressDelivered?.();
        }}
      />
    </div>
  );
}

function EffectsStatus({
  mostRecent,
  currentTurn,
}: {
  mostRecent: MostRecentAddressSummary;
  currentTurn: number;
}) {
  const parts: string[] = [];
  const approvalRemaining = mostRecent.approvalEffect.expiresAtTurn - currentTurn;
  parts.push(
    approvalRemaining > 0
      ? `Approval +${mostRecent.approvalEffect.amount} (expires in ${approvalRemaining}t)`
      : `Approval (expired)`
  );
  if (mostRecent.agendaEffect) {
    const agendaRemaining = mostRecent.agendaEffect.expiresAtTurn - currentTurn;
    parts.push(
      agendaRemaining > 0 ? `Agenda bonus active (${agendaRemaining}t left)` : `Agenda (expired)`
    );
  }
  if (mostRecent.demographicEffect && mostRecent.demographicEffect.turnoutDelta > 0) {
    const demoRemaining = mostRecent.demographicEffect.expiresAtTurn - currentTurn;
    parts.push(
      demoRemaining > 0
        ? `Turnout +${mostRecent.demographicEffect.turnoutDelta} (${demoRemaining}t left)`
        : `Turnout boost (expired)`
    );
  }
  return <p className="text-xs text-muted">{parts.join(" · ")}</p>;
}
