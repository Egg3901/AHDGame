import type { Metadata } from "next";
import { Suspense } from "react";
import { MarketHub } from "@/components/market/MarketHub";

export const metadata: Metadata = {
  title: "The Market | A House Divided",
  description:
    "Stocks, bonds, funds, sectors for sale, commodities, supply deals and currencies in one place.",
};

export default function MarketPage() {
  return (
    <Suspense fallback={null}>
      <MarketHub />
    </Suspense>
  );
}
