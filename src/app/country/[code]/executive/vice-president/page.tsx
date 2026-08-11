"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { PartyChip } from "@/app/congress/components/CongressShared";
import { Skeleton } from "@/components/ui";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { useVicePresidentOffice, type VpOfficeHolder } from "./useVicePresidentOffice";
import { VpActionPanel } from "./components/VpActionPanel";

function HolderRow({ label, holder }: { label: string; holder: VpOfficeHolder | null }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted">
        {label}
      </span>
      {holder ? (
        <span className="inline-flex min-w-0 items-center gap-2">
          <Avatar
            url={holder.avatarUrl}
            name={holder.characterName}
            size="h-7 w-7"
            className="shrink-0 rounded-md"
          />
          <Link
            href={`/character/${holder.sequentialId ?? holder.characterId}`}
            className="truncate text-sm font-medium text-foreground hover:underline"
          >
            {holder.characterName}
          </Link>
          {holder.partyName && holder.partyColor && (
            <PartyChip
              partyName={holder.partyName}
              partyColor={holder.partyColor}
              partyId={holder.party}
            />
          )}
        </span>
      ) : (
        <span className="inline-flex items-center rounded-full border border-warning/40 px-2.5 py-1 text-xs font-semibold text-warning">
          Vacant
        </span>
      )}
    </div>
  );
}

export default function VicePresidentOfficePage() {
  const params = useParams();
  const countryCode = (params.code as string).toLowerCase();
  const countryId = countryCode.toUpperCase() as CountryId;
  const countryName = COUNTRY_CONFIGS[countryId]?.name ?? countryId;

  const { data, loading, error, refetch } = useVicePresidentOffice(countryCode);

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-3xl space-y-4 px-4 py-8 sm:px-6">
          <Skeleton className="h-[180px] w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </main>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <div className="rounded-xl border border-error/30 bg-error/10 p-6 text-center">
            <h2 className="text-lg font-semibold text-error">{error ?? "Failed to load"}</h2>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <header className="rounded-2xl border border-card-border bg-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                {countryName}
              </div>
              <h1 className="mt-1 text-2xl font-bold text-foreground">Vice President</h1>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-card-border bg-card-muted px-2.5 py-1 text-xs font-medium text-foreground/80">
              {data.vpActionsRemaining}/{data.actionCap} Actions
            </span>
          </div>
          <div className="mt-4 space-y-2">
            <HolderRow label="Office holder" holder={data.vicePresident} />
            <HolderRow label="Serves under" holder={data.president} />
          </div>
        </header>

        <VpActionPanel
          actions={data.actions}
          actionsRemaining={data.vpActionsRemaining}
          resetHint={data.resetHint}
          canAct={data.isVicePresident}
          hasPresident={!!data.president && !data.president.isNPP}
          countryCode={countryCode}
          onUpdate={refetch}
        />
      </main>
    </div>
  );
}
