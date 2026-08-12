import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { TutorialHubClient } from "./TutorialHubClient";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tutorial");
  return publicPageMetadata({
    title: t("hub.metaTitle"),
    description: t("hub.metaDescription"),
    pathname: "/tutorial",
  });
}

export default function TutorialHubPage() {
  return <TutorialHubClient />;
}
