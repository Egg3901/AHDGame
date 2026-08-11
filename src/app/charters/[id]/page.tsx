import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ObjectId } from "mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { getGameClock } from "@/lib/time/gameClock.server";
import { Badge } from "@/components/ui";
import { PlatformSliders } from "@/components/charters/PlatformSliders";
import { CharterActions } from "@/components/charters/CharterActions";
import type { Character, PartyCharter, PartyCharterStatus, PoliticalParty } from "@/lib/db/types";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";

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

interface PageParams {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function CharterDetailPage({ params }: PageParams) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) notFound();

  const user = await getAuthUserWithCharacter();
  if (!user) redirect(`/login?returnUrl=/charters/${id}`);

  const db = await getDb();
  const charter = await db
    .collection<PartyCharter>("partyCharters")
    .findOne({ _id: new ObjectId(id) });
  if (!charter) notFound();

  const clock = await getGameClock();

  // Look up display names for the founder characters.
  const founderCharacters = await db
    .collection<Character>("characters")
    .find({ _id: { $in: charter.foundersCharacterIds } })
    .project<{ _id: ObjectId; name: string; userId: ObjectId | null | undefined }>({
      name: 1,
      userId: 1,
    })
    .toArray();
  const characterById = new Map(
    founderCharacters.map((c) => [c._id.toString(), { name: c.name, userId: c.userId ?? null }])
  );

  // The viewer's "my signatures" surface includes any slot owned by the
  // session user — multi-character users may hold multiple slots, so we
  // treat sign/reject as "owned by me" not "matches my active character".
  const userObjectId = new ObjectId(user.userId);
  const myCharacterIds = new Set(
    founderCharacters
      .filter((c) => c.userId && c.userId.equals(userObjectId))
      .map((c) => c._id.toString())
  );
  const myActiveCharacterId = user.character?._id.toString() ?? null;
  const myActiveSig = myActiveCharacterId
    ? charter.signatures.find((s) => s.characterId.toString() === myActiveCharacterId)
    : undefined;
  const myActiveIsFounder = myActiveCharacterId !== null && myCharacterIds.has(myActiveCharacterId);
  const canAct = myActiveIsFounder && charter.status === "pending-signatures";
  const signedCount = charter.signatures.filter((s) => s.signedAt).length;
  const requiredCount = charter.foundersCharacterIds.length;

  // Phase 4: surface the banned-at-creation state for one-party-state
  // ratifications. Charter status `ratified` + party doc carrying
  // `regimeStatus: "banned"` means the player's new party is inert by
  // default and they need to know what that means.
  const ratifiedParty =
    charter.status === "ratified" && charter.partyId
      ? await db
          .collection<PoliticalParty>("politicalParties")
          .findOne({ countryId: charter.countryId, sequentialId: Number(charter.partyId) })
      : null;
  const isBannedAtCreation = ratifiedParty?.regimeStatus === "banned";
  const countryName = COUNTRY_CONFIGS[charter.countryId]?.name ?? charter.countryId;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <Link href="/charters" className="text-xs text-muted hover:underline">
          ← All charters
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">
            {charter.proposedName}{" "}
            <span className="font-normal text-muted">({charter.proposedAbbr})</span>
          </h1>
          <Badge variant="solid" color={STATUS_VARIANT[charter.status]}>
            {charter.status}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted">
          {/* wall-clock by design: charter.createdAt is an immutable history timestamp */}
          {charter.countryId} · created {charter.createdAt.toLocaleString()}
          {charter.expiresAt
            ? ` · expires ${clock.formatAbsoluteDeadline(
                // Project from the turn so the displayed deadline stays put across
                // pauses (drift-immune); fall back to the stored Date for legacy docs.
                (typeof charter.expiresOnTurn === "number"
                  ? clock.projectTurnToDate(charter.expiresOnTurn)
                  : null) ?? charter.expiresAt
              )}`
            : ""}
          {charter.partyId ? ` · party #${charter.partyId}` : ""}
        </p>
      </div>

      {isBannedAtCreation && (
        <section className="mb-6 rounded-lg border border-rose-500/40 bg-rose-500/10 p-5">
          <h2 className="mb-2 text-sm font-bold text-rose-300">
            Party created — but banned in {countryName}
          </h2>
          <p className="mb-3 text-sm text-foreground">
            <strong>{charter.proposedName}</strong> was successfully ratified, but {countryName} is
            a one-party state. New parties are automatically banned at creation by the regime.
          </p>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-300">
            What this means
          </p>
          <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-foreground">
            <li>Your party cannot field election candidates.</li>
            <li>Members of your party cannot propose or vote on legislation.</li>
            <li>The party cannot accept donations or hold cabinet positions.</li>
            <li>Members holding seats lost them when the ban was recorded.</li>
          </ul>
          <p className="text-sm text-foreground">
            <strong>What to do:</strong> Reach out to a game administrator if you believe your party
            should be approved by the regime. Once promoted to <em>Approved</em>, the party regains
            full legislative participation (but still cannot form government — only the ruling party
            can).
          </p>
        </section>
      )}

      <section className="mb-6 rounded-lg border border-card-border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold">Platform</h2>
        <PlatformSliders value={charter.platform} readOnly />
      </section>

      <section className="mb-6 rounded-lg border border-card-border bg-card p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">
            Founders ({signedCount}/{requiredCount} signed)
          </h2>
          {charter.pendingFounderSlots > 0 && (
            <Badge variant="solid" color="warning">
              {charter.pendingFounderSlots} pending slot
              {charter.pendingFounderSlots === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
        <p className="mb-3 text-xs text-muted">
          On ratification the party opens with <strong>vacant leadership</strong> — chair, vice
          chair, and treasurer are decided by leadership elections that open immediately on the
          shared election cycle.
        </p>
        <ul className="space-y-2">
          {charter.foundersCharacterIds.map((cid, index) => {
            const sig = charter.signatures.find((s) => s.characterId.equals(cid));
            const meta = characterById.get(cid.toString());
            const characterName =
              meta?.name ?? (sig?.rejectedAt ? "[Founder removed]" : "[Deleted founder]");
            const isMine = myCharacterIds.has(cid.toString());
            const status: { label: string; color: "success" | "error" | "default" } = sig?.signedAt
              ? { label: "signed", color: "success" }
              : sig?.rejectedAt
                ? { label: "rejected", color: "error" }
                : { label: "awaiting", color: "default" };
            const role = `Founder ${index + 1}`;
            return (
              <li
                key={cid.toString()}
                className="flex items-center justify-between rounded-md border border-card-border bg-background/50 px-3 py-2"
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-muted">{role}</span>
                  <span className="font-medium">
                    {characterName}
                    {isMine && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-primary">
                        yours
                      </span>
                    )}
                  </span>
                </span>
                <Badge color={status.color}>{status.label}</Badge>
              </li>
            );
          })}
        </ul>
      </section>

      {canAct && (
        <section className="rounded-lg border border-card-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">Your decision</h2>
          <CharterActions
            charterId={charter._id.toString()}
            alreadySigned={Boolean(myActiveSig?.signedAt)}
            alreadyRejected={Boolean(myActiveSig?.rejectedAt)}
          />
        </section>
      )}
    </div>
  );
}
