"use client";
import { useSearchParams, useParams } from "next/navigation";
import { redirect } from "next/navigation";

export default function PartyRedirect() {
  const searchParams = useSearchParams();
  const { id } = useParams();
  const country = searchParams.get("country")?.toLowerCase() || "us";
  redirect(`/country/${country}/parties/${id}`);
}
