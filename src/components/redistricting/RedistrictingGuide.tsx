import Link from "next/link";

/**
 * The editor's eligibility response names only the first blocked gate. Keep the
 * full route to a redraw visible even when a player cannot open the editor yet.
 */
export function RedistrictingGuide() {
  return (
    <details className="rounded-lg border border-card-border bg-card px-4 py-3 text-sm" open>
      <summary className="cursor-pointer font-semibold text-foreground">
        How to redraw a House map
      </summary>
      <div className="mt-3 space-y-3 text-sm text-muted">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            In the state legislature, pass the{" "}
            <strong className="text-foreground">State Redistricting Authority Act</strong> with the{" "}
            <strong className="text-foreground">Legislature-drawn</strong> option. This is a normal
            state bill. Independent and bipartisan commissions prevent a partisan redraw.
          </li>
          <li>
            Hold a state trifecta: the same party must control the governorship and the state
            legislature. The governor who opens this page submits the map, so an NPP governor does
            not give another player permission to draw one.
          </li>
          <li>
            Redraw during the census year. A state gets one non-admin redraw per census, and the new
            lines apply at its next House election.
          </li>
        </ol>
        <p>
          You redistribute fixed Left, Right, and Swing voter blocks between districts. Packing an
          opponent&apos;s voters into a few lopsided seats can create more narrow wins for your
          side, within the state&apos;s compactness and fairness laws. Exactly even districts are
          toss-ups; the map gives neither side a lean there.
        </p>
        <Link href="/wiki/us-house-redistricting" className="text-primary hover:underline">
          Read the full redistricting guide →
        </Link>
      </div>
    </details>
  );
}
