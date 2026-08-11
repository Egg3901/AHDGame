import { redirect } from "next/navigation";
import ForexPage from "@/app/country/[code]/forex/page";

/**
 * Routing shim: /forex/global renders the forex index with country-agnostic view.
 * Country-specific URLs redirect to /country/[code]/forex.
 */
export default async function ForexCountryShim({
  params,
}: {
  params: Promise<{ country: string }>;
}) {
  const { country } = await params;

  if (country.toLowerCase() === "global") {
    const codeParams = Promise.resolve({ code: "us" });
    return <ForexPage params={codeParams} />;
  }

  redirect(`/country/${country.toLowerCase()}/forex`);
}
