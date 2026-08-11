"use client";
import { useSearchParams } from "next/navigation";
import { redirect } from "next/navigation";

export default function BudgetRedirect() {
  const searchParams = useSearchParams();
  const country = searchParams.get("country")?.toLowerCase() || "us";
  redirect(`/country/${country}/budget`);
}
