import { redirect } from "next/navigation";
import Link from "next/link";
import { ObjectId } from "mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { Badge } from "@/components/ui";
import type { Character, PartyCharter, PartyCharterStatus } from "@/lib/db/types";

const STATUS_VARIANT: Record<PartyCharterStatus, "default" | "warning" | "success" | "error"> = {
  draft: "default",
  "pending-signatures": "warning",
  ratified: "success",
  "founder-replacement": "warning",
  rejected: "error",
  expired: "error",
  migrated: "success",
  "migrated-incomplete": "warning",
};

export const dynamic = "force-dynamic";

export default async function ChartersListPage() {
  const user = await getAuthUserWithCharacter();
  if (!user) redirect("/login?returnUrl=/charters");

  const db = await getDb();
  const userObjectId = new ObjectId(user.userId);

  // Founder identity is `characterId`. Resolve every character owned by
  // the session user → list charters where any of those characters is
  // a founder. Multi-character users see every charter their personas
  // are involved in.
  const ownedCharacters = await db
    .collection<Character>("characters")
    .find({ userId: userObjectId })
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();
  const ownedCharacterIds = ownedCharacters.map((c) => c._id);
  const ownedCharacterIdStrings = new Set(ownedCharacterIds.map((c) => c.toString()));

  const charters = ownedCharacterIds.length
    ? await db
        .collection<PartyCharter>("partyCharters")
        .find({ foundersCharacterIds: { $in: ownedCharacterIds } })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray()
    : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Party Charters</h1>
          <p className="mt-1 text-sm text-muted">
            Charters you&apos;re a founder on. Sign or reject pending drafts; track active
            ratifications.
          </p>
        </div>
        <Link
          href={`/country/${user.character?.countryId.toLowerCase() ?? "us"}/parties`}
          className="text-sm font-medium text-primary hover:underline"
        >
          Browse parties →
        </Link>
      </div>

      {charters.length === 0 ? (
        <div className="rounded-lg border border-card-border bg-card p-6 text-center text-sm text-muted">
          You&apos;re not on any charter yet. Charters appear here once another player names you as
          a founder, or when you draft your own.
        </div>
      ) : (
        <ul className="space-y-3">
          {charters.map((charter) => {
            // "My" sig is any sig bound to a character I own — for
            // multi-character users this picks the first match, which
            // is good enough for the badge ("you signed" / "you
            // rejected"). The detail page surfaces every slot.
            const mySig = charter.signatures.find((s) =>
              ownedCharacterIdStrings.has(s.characterId.toString())
            );
            const signedCount = charter.signatures.filter((s) => s.signedAt).length;
            const requiredCount = charter.foundersCharacterIds.length;
            return (
              <li key={charter._id.toString()}>
                <Link
                  href={`/charters/${charter._id.toString()}`}
                  className="block rounded-lg border border-card-border bg-card p-4 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold">
                        {charter.proposedName}{" "}
                        <span className="font-normal text-muted">({charter.proposedAbbr})</span>
                      </h2>
                      <p className="mt-1 text-xs text-muted">
                        {charter.countryId} ·{" "}
                        {charter.status === "pending-signatures"
                          ? `${signedCount}/${requiredCount} signed`
                          : charter.status === "founder-replacement"
                            ? `awaiting replacement founder`
                            : null}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="solid" color={STATUS_VARIANT[charter.status]}>
                        {charter.status}
                      </Badge>
                      {mySig?.signedAt && <span className="text-[10px] text-success">signed</span>}
                      {mySig?.rejectedAt && (
                        <span className="text-[10px] text-error">you rejected</span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
