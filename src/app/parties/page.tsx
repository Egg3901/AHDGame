"use client";
import { useSearchParams } from "next/navigation";
import { redirect } from "next/navigation";

export default function PartiesRedirect() {
  const searchParams = useSearchParams();
  const country = searchParams.get("country")?.toLowerCase() || "us";
  redirect(`/country/${country}/parties`);
}
