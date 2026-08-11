// src/app/wiki/paths/[pathId]/page.tsx
import { notFound } from "next/navigation";
import { getVisibleLearningPathBySlug } from "@/lib/wiki/learningPaths";
import LearningPathView from "./LearningPathView";

interface PageProps {
  params: Promise<{ pathId: string }>;
}

export default async function LearningPathPage({ params }: PageProps) {
  const { pathId } = await params;
  const path = await getVisibleLearningPathBySlug(pathId);

  if (!path) {
    notFound();
  }

  return <LearningPathView path={path} pathId={pathId} />;
}
