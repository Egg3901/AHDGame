import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ regionId: string }>;
}

export default async function LegacyUKRegionPage({ params }: Props) {
  const { regionId } = await params;
  redirect(`/country/uk/region/${regionId}`);
}
