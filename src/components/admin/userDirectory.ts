export interface AdminDirectoryUser {
  id?: string;
  _id?: string;
  username?: string;
  characterId?: string | null;
  characterName?: string | null;
}

const USER_PAGE_SIZE = 2000;

/** Load every account from the admin/moderator directory, respecting the
 * admin endpoint's bounded pagination while remaining compatible with the
 * moderator endpoint, which currently returns its full directory at once. */
export async function fetchAdminDirectoryUsers(apiBase: string): Promise<AdminDirectoryUser[]> {
  const users: AdminDirectoryUser[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const response = await fetch(`${apiBase}/users?limit=${USER_PAGE_SIZE}&offset=${offset}`);
    if (!response.ok) throw new Error(`Failed to load users (${response.status})`);

    const data = await response.json();
    const page: AdminDirectoryUser[] = Array.isArray(data) ? data : (data.users ?? []);
    users.push(...page);

    const reportedTotal = Number(data.total);
    total = Number.isFinite(reportedTotal) ? reportedTotal : users.length;
    offset += page.length;

    if (page.length === 0 || offset >= total || page.length < USER_PAGE_SIZE) break;
  }

  return users;
}
