import type { Metadata } from "next";
import IntorgIndexClient from "./IntorgIndexClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "International Organizations · A House Divided",
  description: "Multilateral institutions, free-trade agreements, and Secretary-General elections.",
};

export default function InternationalOrganizationsPage() {
  return <IntorgIndexClient />;
}
