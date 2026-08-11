#!/usr/bin/env bash
#
# Start the local sim worker with the config written by local-setup.sh.
#
# worker.ts reads plain process.env (on the ops box systemd supplies it via
# EnvironmentFile). This wrapper is the local equivalent: it loads
# .env.sim.local into the environment and hands off. Nothing else.
#
# Usage:  npm run sim:worker
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"

ENV_FILE="$REPO_DIR/.env.sim.local"
if [ ! -f "$ENV_FILE" ]; then
  printf '\n\033[1;31mx   No .env.sim.local found.\033[0m\n\n    Run the setup first:\n\n        npm run sim:setup\n\n' >&2
  exit 1
fi

# set -a exports everything assigned while it is on, which is what turns a
# plain KEY=value file into environment variables for the child.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

printf '\n\033[1;36m==> sim worker starting\033[0m\n'
printf '    queue    %s (db=%s)\n' "${OPS_MONGODB_URI:-unset}" "${OPS_DB_NAME:-unset}"
printf '    sandbox  %s\n' "${SIM_MONGODB_URI:-unset}"
printf '    repo     %s\n' "${GAME_REPO_DIR:-$REPO_DIR}"
printf '\n    Leave this terminal open. Ctrl-C stops the worker.\n\n'

exec npx tsx scripts/sim/worker.ts
