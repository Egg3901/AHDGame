import { redirect } from "next/navigation";

/** The standalone setup screen moved into the admin panel:
 * System → Post Reset Checklist embeds the same SetupPanel (readiness checks,
 * run-setup, IMF institution seed). This route survives as a redirect so old
 * links and reset-log messages keep working. */
export default function AdminSetupPage() {
  redirect("/admin?tab=system&sub=post-reset");
}
