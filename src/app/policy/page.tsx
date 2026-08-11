"use client";
import { useSearchParams } from "next/navigation";
import { redirect } from "next/navigation";

export default function PolicyRedirect() {
  const searchParams = useSearchParams();
  const country = searchParams.get("country")?.toLowerCase() || "us";
  redirect(`/country/${country}/policy`);
}
