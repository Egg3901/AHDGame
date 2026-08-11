import PortfolioClient from "./PortfolioClient";

// SECURITY — cross-user data leak (P0). Portfolio holdings are per-user PII. The
// W2 audit server-rendered them into the HTML by seeding `initialPortfolio` from
// a direct DB call; when that HTML is cached at the edge with a key that ignores
// the session cookie, one user's portfolio is served to another. Render ONLY the
// client shell (no per-user data in the HTML) and let PortfolioClient fetch
// /api/character/portfolio itself — per-user, cookie-scoped, `cache: no-store`.
// A cached shell is then harmless because it contains no PII.
export default function PortfolioPage() {
  return <PortfolioClient />;
}
