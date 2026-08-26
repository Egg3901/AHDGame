import type { Metadata } from "next";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { EmptyState } from "@/components/ui";
import { loadGermanQuestionDossier } from "@/lib/settlement/queries/dossier";
import { loadGermanQuestionWarNotice } from "@/lib/settlement/queries/warNotice";
import { GermanQuestionClient } from "./GermanQuestionClient";

export const metadata: Metadata = publicPageMetadata({
  title: "The German Question | A House Divided",
  description:
    "Four institutions decide whether West Germany stays sovereign inside NATO or dissolves into a reunified Germany in the Warsaw Pact, contested by East Berlin, Moscow, Washington and London.",
  pathname: "/world/german-question",
});

export default async function GermanQuestionPage() {
  const user = await getAuthUserWithCharacter();
  if (!user?.character) {
    return (
      <EmptyState
        title="No character"
        description="The German Question is played by a character. Create one to take a position."
        actionLabel="Create a character"
        actionHref="/character/create"
      />
    );
  }

  const db = await getDb();
  const view = await loadGermanQuestionDossier(db, user.character._id);

  // Null covers "the feature is gated off", "no crisis is open" and "the crisis
  // is frozen". None is an error, and none should throw. The third one has a
  // story worth telling, so it is checked before the generic empty state.
  if (!view) {
    const war = await loadGermanQuestionWarNotice(db);
    if (war) {
      return (
        <EmptyState
          title="The question is being settled by war"
          description={
            war.attached
              ? `The board is frozen where it stood. War was declared over one of the Germanies, and ${war.name} will decide the settlement outright.`
              : `The board is frozen where it stood. The four powers went to the brink and over it, and ${war.name} will decide the settlement outright.`
          }
          actionLabel={war.conflictNumber === null ? "Back to the world" : "Follow the war"}
          actionHref={
            war.conflictNumber === null ? "/world" : `/world/conflicts/${war.conflictNumber}`
          }
        />
      );
    }
    return (
      <EmptyState
        title="No settlement crisis is open"
        description="The German Question is not running in this world. It opens when the four powers are all in play."
        actionLabel="Back to the world"
        actionHref="/world"
      />
    );
  }

  return <GermanQuestionClient initialView={view} />;
}
