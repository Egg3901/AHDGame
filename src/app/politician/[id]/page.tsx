import { ObjectId } from "mongodb";
import { notFound, redirect } from "next/navigation";
import type { Character, NPP } from "@/lib/db/types";
import { getDb } from "@/lib/mongodb";
import {
  buildCharacterHref,
  buildNppHref,
  parseCharacterId,
  parseNppId,
} from "@/lib/utils/profileUrls";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PoliticianRedirectPage({ params }: PageProps) {
  const { id } = await params;
  const db = await getDb();
  const parsedCharacterId = parseCharacterId(id);
  const characterQuery =
    parsedCharacterId?.type === "sequential"
      ? { sequentialId: parsedCharacterId.value }
      : parsedCharacterId?.type === "objectId"
        ? { _id: new ObjectId(parsedCharacterId.value) }
        : null;
  const character = characterQuery
    ? await db
        .collection<Character>("characters")
        .findOne(characterQuery, { projection: { _id: 1, sequentialId: 1 } })
    : null;
  if (character) {
    redirect(buildCharacterHref(character));
  }

  const parsedNppId = parseNppId(id);
  const nppQuery =
    parsedNppId?.type === "sequential"
      ? { sequentialId: parsedNppId.value }
      : parsedNppId?.type === "objectId"
        ? { _id: new ObjectId(parsedNppId.value) }
        : null;
  const npp = nppQuery
    ? await db
        .collection<NPP>("npps")
        .findOne(nppQuery, { projection: { _id: 1, sequentialId: 1 } })
    : null;
  if (npp) {
    redirect(buildNppHref(npp));
  }

  notFound();
}
