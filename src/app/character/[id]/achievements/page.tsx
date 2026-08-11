import { ObjectId } from "mongodb";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import type { Character } from "@/lib/db/types";
import { parseCharacterId } from "@/lib/utils/profileUrls";
import { AchievementsShowcaseClient } from "./AchievementsShowcaseClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AchievementsShowcasePage({ params }: PageProps) {
  const { id } = await params;
  const parsed = parseCharacterId(id);
  if (!parsed) notFound();

  const db = await getDb();
  const character =
    parsed.type === "sequential"
      ? await db.collection<Character>("characters").findOne({ sequentialId: parsed.value })
      : await db.collection<Character>("characters").findOne({ _id: new ObjectId(parsed.value) });
  if (!character) notFound();

  return (
    <AchievementsShowcaseClient
      characterId={character._id.toString()}
      characterName={character.name}
      avatarUrl={character.avatarUrl}
    />
  );
}
