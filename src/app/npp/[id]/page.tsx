import { notFound, redirect } from "next/navigation";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { parseNppId } from "@/lib/utils/profileUrls";
import type { NPP } from "@/lib/db/types";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function LegacyNPPPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = parseNppId(id);

  if (!parsed) notFound();

  if (parsed.type === "sequential") {
    redirect(`/politicians/npp/${parsed.value}`);
  }

  // ObjectId lookup
  if (!ObjectId.isValid(parsed.value)) notFound();

  const db = await getDb();
  const npp = await db.collection<NPP>("npps").findOne({ _id: new ObjectId(parsed.value) });

  if (!npp) notFound();

  if (npp.sequentialId) {
    redirect(`/politicians/npp/${npp.sequentialId}`);
  }

  redirect(`/politicians/npp/${parsed.value}`);
}
