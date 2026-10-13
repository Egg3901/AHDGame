"use client";
import { useParams } from "next/navigation";
import { SubsidiaryGroupPage } from "@/components/corporation/groups/SubsidiaryGroupPage";
export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <SubsidiaryGroupPage key={id} corpId={id} />;
}
