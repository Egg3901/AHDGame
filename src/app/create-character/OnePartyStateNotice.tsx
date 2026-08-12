"use client";

import { DEFAULT_OPS_VOTE_MULTIPLIERS } from "@/lib/constants/countries";
import { blocListQuota } from "@/lib/constants/blocList";

/**
 * The one-party-state briefing.
 *
 * Every number here comes from `DEFAULT_OPS_VOTE_MULTIPLIERS` and
 * `canFieldLegislativeCandidate`, so the warning states the actual mechanic
 * rather than a vague "may struggle". Under the default multipliers an
 * independent's vote weight is literally zero — this is not a difficulty
 * setting, it is a wall.
 */
export function OnePartyStateNotice({
  countryName,
  rulingPartyName,
  countryId,
}: {
  countryName: string;
  rulingPartyName: string | null;
  /** Selects the bloc-list briefing where the country runs one. */
  countryId?: string | null;
}) {
  const m = DEFAULT_OPS_VOTE_MULTIPLIERS;
  const rulingVsApproved = m.approved > 0 ? Math.round((m.ruling / m.approved) * 10) / 10 : null;
  const quota = blocListQuota(countryId);

  // Bloc-list countries do not use the vote multipliers at all, so quoting them
  // here would be a straight lie: the quota decides the party split and the
  // vote only orders a party's own slate. Numbers come from BLOC_LIST_QUOTAS.
  if (quota) {
    const total = Object.values(quota.shares).reduce((s, v) => s + v, 0) || 1;
    const rulingPct = Math.round(((quota.shares["1"] ?? 0) / total) * 100);
    const blocPcts = Object.entries(quota.shares)
      .filter(([party]) => party !== "1")
      .map(([, w]) => Math.round((w / total) * 1000) / 10);
    const blocPct = blocPcts.length > 0 ? blocPcts[0] : 0;

    return (
      <div className="rounded border border-warning/40 bg-warning/10 p-3 text-body-sm">
        <p className="font-semibold text-warning">
          {countryName} elects its legislature on a single {quota.label} list.
        </p>

        <p className="mt-1.5 leading-relaxed text-foreground/90">
          There is no contest between parties. Every seat is allocated before a vote is cast, and
          the election only decides which of a party&apos;s own people fill its share.
        </p>

        <ul className="mt-2 space-y-1 text-muted">
          <li className="flex gap-2">
            <span aria-hidden className="text-warning">
              •
            </span>
            <span>
              <span className="font-semibold">
                {rulingPartyName ? rulingPartyName : "The ruling party"}
              </span>{" "}
              holds <span className="font-mono font-semibold">{rulingPct}%</span> of the chamber and{" "}
              {blocPcts.length > 0 ? `each bloc party ` : "the bloc parties hold "}
              <span className="font-mono font-semibold">{blocPct}%</span>. Winning the popular vote
              changes neither number.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="text-warning">
              •
            </span>
            <span>
              Your votes decide your standing{" "}
              <span className="font-semibold">inside your own party&apos;s block</span>. A bloc
              party is a real place to build a career; it is not a route to a majority.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="text-warning">
              •
            </span>
            <span>
              Parties off the list, and independents, take{" "}
              <span className="font-mono font-semibold text-error">no seats at all</span>. There is
              no ballot line outside the {quota.label}.
            </span>
          </li>
        </ul>

        <p className="mt-2 leading-relaxed text-foreground/90">
          The way the split changes is political, not electoral. Reform belongs to the ruling
          party&apos;s leadership: liberalising the regime, legalising opposition, calling a
          constitutional convention, and ultimately converting the country to a competitive system.
          Take the party, then take it somewhere.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded border border-warning/40 bg-warning/10 p-3 text-body-sm">
      <p className="font-semibold text-warning">{countryName} is a one-party state.</p>

      <p className="mt-1.5 leading-relaxed text-foreground/90">
        Join{" "}
        <span className="font-semibold">
          {rulingPartyName ? `the ${rulingPartyName}` : "the ruling party"}
        </span>
        . This is not a flavour choice — outside it the electoral maths does not work.
      </p>

      <ul className="mt-2 space-y-1 text-muted">
        <li className="flex gap-2">
          <span aria-hidden className="text-warning">
            •
          </span>
          <span>
            Independents carry a{" "}
            <span className="font-mono font-semibold text-error">{m.independent.toFixed(1)}×</span>{" "}
            vote weight and cannot be fielded as legislative candidates at all. Running outside a
            party here is not a hard path, it is a dead end.
          </span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden className="text-warning">
            •
          </span>
          <span>
            Approved bloc parties get <span className="font-mono font-semibold">{m.approved}×</span>{" "}
            against the ruling party&apos;s{" "}
            <span className="font-mono font-semibold">{m.ruling}×</span>
            {rulingVsApproved ? ` — about ${rulingVsApproved}× the weight` : ""}. You can win a seat
            in one; you will not take the country with one.
          </span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden className="text-warning">
            •
          </span>
          <span>
            Banned parties are inert: their officials lose their seats and their candidates score{" "}
            <span className="font-mono font-semibold">{m.banned.toFixed(1)}×</span>.
          </span>
        </li>
      </ul>

      <p className="mt-2 leading-relaxed text-foreground/90">
        If you want to change the system, change it from inside. Reform here is a real mechanic and
        it belongs to the ruling party&apos;s leadership — liberalising the regime, legalising
        opposition, calling a constitutional convention, and ultimately converting the country to a
        competitive system all run through that office. Take the party, then take it somewhere.
      </p>
    </div>
  );
}
