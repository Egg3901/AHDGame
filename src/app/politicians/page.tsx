"use client";
import { useSearchParams } from "next/navigation";
import { redirect } from "next/navigation";

export default function PoliticiansRedirect() {
  const searchParams = useSearchParams();
  const country = searchParams.get("country")?.toLowerCase() || "us";
  redirect(`/country/${country}/politicians`);
}
