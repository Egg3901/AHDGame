import { redirect } from "next/navigation";

/**
 * Dashboard redirect — sends users to /profile until a real dashboard is built.
 * Many links and error boundaries reference /dashboard; this prevents 404s.
 */
export default function DashboardPage() {
  redirect("/profile");
}
