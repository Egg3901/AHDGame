import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return {
    title: t("register.metaTitle"),
    description: t("register.metaDescription"),
  };
}

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
