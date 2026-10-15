"use client";
import { useParams } from "next/navigation";
import { PublicSubsidiaryGroupPage } from "@/components/corporation/groups/PublicSubsidiaryGroupPage";
export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <PublicSubsidiaryGroupPage key={id} corpId={id} />;
}
