import { redirect } from "next/navigation";
import Link from "next/link";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { DraftCharterForm } from "@/components/charters/DraftCharterForm";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getDb } from "@/lib/mongodb";
import type { State } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export default async function NewCharterPage() {
  const user = await getAuthUserWithCharacter();
  if (!user) redirect("/login?returnUrl=/charters/new");
  // Avoid a redirect loop: a logged-in user without a character can't
  // proceed regardless of how many times they re-auth, so route them to
  // character creation rather than back to login.
  if (!user.character) redirect("/create-character");

  const countryCode = user.character.countryId;
  const countryName = COUNTRY_CONFIGS[countryCode as CountryId]?.name ?? countryCode;
  const proposer = {
    characterId: user.character._id.toString(),
    characterName: user.character.name,
    homeState: user.character.homeState,
  };

  // F4 founding-cohort picker needs human-readable state names for the
  // dropdowns. Fetched server-side so no client-side round-trip is needed.
  const db = await getDb();
  const states = await db
    .collection<State>("states")
    .find({ countryId: countryCode }, { projection: { _id: 1, name: 1 } })
    .toArray();
  const stateNames: Record<string, string> = Object.fromEntries(
    states.map((s) => [s._id, s.name ?? s._id])
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link href="/charters" className="text-xs text-muted hover:underline">
          ← All charters
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Draft a Party Charter</h1>
        <p className="mt-1 text-sm text-muted">
          A charter is the founding agreement for a new party. You name the three founders and set
          the platform; once all three sign, the party is ratified and goes live in {countryName}.
          The new party starts with <strong>no leaders</strong>: the chair, vice chair, and
          treasurer are decided by leadership elections that open straight away on the shared
          election cycle.
        </p>
      </div>

      <div className="rounded-lg border border-card-border bg-card p-6">
        <DraftCharterForm countryCode={countryCode} proposer={proposer} stateNames={stateNames} />
      </div>

      <div className="mt-4 rounded-md border border-card-border bg-card/40 p-4 text-xs text-muted">
        <p className="mb-1 font-semibold">How signing works</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Each founder gets a charter detail page where they can sign or reject.</li>
          <li>You auto-sign your slot when you submit this draft.</li>
          <li>Co-founders must live in your home state or a state adjacent to it.</li>
          <li>
            Charters expire after 14 turns or 72 IRL hours, whichever is later. Rejections start a
            replacement window with the same deadline.
          </li>
          <li>
            Platform axes are bounded to ±60. Post-ratification amendments can move each axis at
            most ±10 per amendment.
          </li>
        </ul>
      </div>
    </div>
  );
}
