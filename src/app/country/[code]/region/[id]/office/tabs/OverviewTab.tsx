import Link from "next/link";
import { getExecutiveOrderNamePlural, type CountryId } from "@/lib/constants/countries";
import {
  EXEC_ORDER_SLOT_CAP,
  GUBERNATORIAL_ACTION_CAP,
  GUBERNATORIAL_ACTION_REGEN_INTERVAL,
} from "@/lib/constants/governorOffice";
import type { LegislationActivity } from "./LegislationTab";
import type { ActiveOrder } from "./OrdersTab";
import type { MostRecentAddressSummary } from "./AddressTab";
import type { ActiveEndorsement } from "./EndorsementsTab";

interface Props {
  countryId: CountryId;
  stateId: string;
  stateName: string;
  regionalTitle: string;
  officeHolderName: string | null;
  gubernatorialActions: number;
  viewerIsAdmin: boolean;
  viewerIsHolder: boolean;
  legislationActivity: LegislationActivity;
  activeOrders: ActiveOrder[];
  currentTurn: number;
  mostRecentAddress: MostRecentAddressSummary | null;
  addressAvailableAtTurn: number;
  activeEndorsements: ActiveEndorsement[];
}

export function OverviewTab(props: Props) {
  if (!props.officeHolderName) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-8">
        <h2 className="text-lg font-semibold mb-2">Office vacant</h2>
        <p className="text-sm text-muted">
          No {props.regionalTitle.toLowerCase()} is currently in office for {props.stateName}.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card title="Office AP">
        <div className="text-2xl font-bold tabular-nums">
          {props.gubernatorialActions} / {GUBERNATORIAL_ACTION_CAP}
        </div>
        <div className="text-xs text-muted">
          Regenerates by 1 every {GUBERNATORIAL_ACTION_REGEN_INTERVAL} turns
        </div>
      </Card>
      <Card title="Legislation">
        <LegislationSummary
          activity={props.legislationActivity}
          countryId={props.countryId}
          stateId={props.stateId}
        />
      </Card>
      <Card title={getExecutiveOrderNamePlural(props.countryId)}>
        <ExecutiveOrdersSummary activeOrders={props.activeOrders} currentTurn={props.currentTurn} />
      </Card>
      <Card title="State of the State">
        <AddressSummary
          mostRecentAddress={props.mostRecentAddress}
          addressAvailableAtTurn={props.addressAvailableAtTurn}
          currentTurn={props.currentTurn}
        />
      </Card>
      <Card title="Endorsements">
        <EndorsementsSummary activeEndorsements={props.activeEndorsements} />
      </Card>
      {props.viewerIsAdmin && !props.viewerIsHolder && (
        <Card title="Admin notice">
          <div className="text-sm text-muted">
            You are viewing this office page as an admin. Actions remain restricted to the
            office-holder.
          </div>
        </Card>
      )}
    </div>
  );
}

function LegislationSummary({
  activity,
  countryId,
  stateId,
}: {
  activity: LegislationActivity;
  countryId: CountryId;
  stateId: string;
}) {
  if (!activity) {
    return <div className="text-sm text-muted">No bill in flight.</div>;
  }
  const status = describeActivity(activity);
  const billHref =
    activity.kind === "in_flight"
      ? `/country/${countryId.toLowerCase()}/region/${stateId.toLowerCase()}/legislature/bills/${activity.billId}`
      : null;
  return (
    <div className="space-y-1.5">
      {billHref ? (
        <Link
          href={billHref}
          className="block text-sm font-medium truncate hover:underline"
          title={activity.title}
        >
          {activity.title}
        </Link>
      ) : (
        <div className="text-sm font-medium truncate" title={activity.title}>
          {activity.title}
        </div>
      )}
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${status.pillClass}`}
        >
          {status.label}
        </span>
        {status.tally && (
          <span className="text-[11px] tabular-nums text-muted">{status.tally}</span>
        )}
      </div>
    </div>
  );
}

function describeActivity(activity: NonNullable<LegislationActivity>): {
  label: string;
  pillClass: string;
  tally?: string;
} {
  if (activity.kind === "pending") {
    return {
      label: "Queued",
      pillClass: "bg-card-border/40 text-muted",
    };
  }
  if (activity.status === "active") {
    return {
      label: "Voting",
      pillClass: "bg-info/20 text-info",
      tally: `${activity.votesFor}-${activity.votesAgainst}`,
    };
  }
  if (activity.status === "passed") {
    return {
      label: "Awaiting assent",
      pillClass: "bg-warning/20 text-warning",
    };
  }
  return {
    label: "Override voting",
    pillClass: "bg-error/20 text-error",
    tally: `${activity.overrideVotesFor}-${activity.overrideVotesAgainst}`,
  };
}

function ExecutiveOrdersSummary({
  activeOrders,
  currentTurn,
}: {
  activeOrders: ActiveOrder[];
  currentTurn: number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium tabular-nums">
        {activeOrders.length} / {EXEC_ORDER_SLOT_CAP} active
      </div>
      {activeOrders.length === 0 ? (
        <div className="text-xs text-muted">No active orders.</div>
      ) : (
        <ul className="space-y-1 text-xs">
          {activeOrders.map((o) => (
            <li key={o._id} className="truncate" title={o.legislationTypeName}>
              <span className="text-foreground">{o.legislationTypeName}</span>
              <span className="text-muted">
                {" "}
                · expires in {Math.max(0, o.expiresAtTurn - currentTurn)}t
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddressSummary({
  mostRecentAddress,
  addressAvailableAtTurn,
  currentTurn,
}: {
  mostRecentAddress: MostRecentAddressSummary | null;
  addressAvailableAtTurn: number;
  currentTurn: number;
}) {
  const onCooldown = currentTurn < addressAvailableAtTurn;
  const turnsUntil = Math.max(0, addressAvailableAtTurn - currentTurn);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
            onCooldown ? "bg-card-border/40 text-muted" : "bg-success/20 text-success"
          }`}
        >
          {onCooldown ? `Cooldown ${turnsUntil}t` : "Available"}
        </span>
      </div>
      {mostRecentAddress ? (
        <div className="text-xs text-muted">
          Last: {mostRecentAddress.deliveredByName} · T{mostRecentAddress.deliveredAtTurn}
        </div>
      ) : (
        <div className="text-xs text-muted">No address delivered yet.</div>
      )}
    </div>
  );
}

function EndorsementsSummary({ activeEndorsements }: { activeEndorsements: ActiveEndorsement[] }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium tabular-nums">{activeEndorsements.length} active</div>
      {activeEndorsements.length === 0 ? (
        <div className="text-xs text-muted">No active endorsements.</div>
      ) : (
        <ul className="space-y-1 text-xs">
          {activeEndorsements.slice(0, 3).map((e) => (
            <li key={e._id} className="truncate" title={`${e.candidateName} · ${e.electionTitle}`}>
              <span className="text-foreground">{e.candidateName}</span>
              <span className="text-muted"> · {e.electionTitle}</span>
            </li>
          ))}
          {activeEndorsements.length > 3 && (
            <li className="text-muted/80">+{activeEndorsements.length - 3} more</li>
          )}
        </ul>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <h3 className="text-xs uppercase tracking-widest text-muted mb-2">{title}</h3>
      {children}
    </div>
  );
}
