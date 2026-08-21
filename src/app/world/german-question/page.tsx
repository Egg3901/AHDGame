import type { Metadata } from "next";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { EmptyState } from "@/components/ui";
import { loadGermanQuestionDossier } from "@/lib/settlement/queries/dossier";
import { GermanQuestionClient } from "./GermanQuestionClient";

export const metadata: Metadata = publicPageMetadata({
  title: "The German Question | A House Divided",
  description:
    "Four institutions decide whether West Germany stays sovereign inside NATO or dissolves into a reunified Germany in the Warsaw Pact — contested by East Berlin, Moscow, Washington and London.",
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

  // Null covers both "the feature is gated off" and "no crisis is open". Neither
  // is an error, and neither should throw — the board simply is not running.
  if (!view) {
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
