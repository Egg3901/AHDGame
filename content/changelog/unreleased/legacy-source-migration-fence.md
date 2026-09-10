---
badges: [patch]
areas: [backend]
tags: [auth]
---

# Protect account credentials during login migration

Accounts marked for login migration now reject legacy sign-in and credential
changes, including changes that race with a migration lock. Session checks also
reject locked accounts; existing account-cache expiry still applies. Logout and
account revocation remain available.

Admin Discord resets now change only the selected account, preserve another
sign-in method, and revoke prior sessions after a confirmed unlink. Concurrent
credential changes and unavailable writes return errors instead of success.
