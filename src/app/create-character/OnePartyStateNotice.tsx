"use client";

import { DEFAULT_OPS_VOTE_MULTIPLIERS } from "@/lib/constants/countries";

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
}: {
  countryName: string;
  rulingPartyName: string | null;
}) {
  const m = DEFAULT_OPS_VOTE_MULTIPLIERS;
  const rulingVsApproved = m.approved > 0 ? Math.round((m.ruling / m.approved) * 10) / 10 : null;

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
