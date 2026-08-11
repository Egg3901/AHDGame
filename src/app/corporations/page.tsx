import { redirect } from "next/navigation";

/**
 * /corporations now redirects to the unified stock market page.
 * The stock market page handles listings, founding, filtering, and commodities.
 */
export default function CorporationsRedirect() {
  redirect("/stockmarket/global");
}
