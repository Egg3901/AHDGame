import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { COMMODITY_LABELS, COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";
import CommodityOffersClient from "./CommodityOffersClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string }>;
}): Promise<Metadata> {
  const { type } = await params;
  if (!(COMMODITY_TYPES as readonly string[]).includes(type)) return {};
  return { title: `${COMMODITY_LABELS[type as CommodityType]} supply offers | A House Divided` };
}

export default async function CommodityOffersPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  if (!(COMMODITY_TYPES as readonly string[]).includes(type)) notFound();
  return <CommodityOffersClient commodity={type as CommodityType} />;
}
