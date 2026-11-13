#!/bin/bash
set -euo pipefail

# Only run in remote Claude Code on the web environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel)}"

echo "Installing npm dependencies..."
# `ci`, not `install`: `npm install` REWRITES package-lock.json, and npm 10 writes it back without
# the `libc` fields that several families of prebuilt native binaries publish (CLAUDE.md has the
# count command). Every session on a machine where corepack has not honoured the npm 11 pin then
# starts with a corrupted lockfile in the working tree, which looks like ordinary churn in a diff
# and has been committed by accident before.
# `npm ci` installs FROM the lockfile and never writes to it, so the corruption cannot happen
# regardless of which npm is running.
npm ci --ignore-scripts

echo "Generating Prisma client..."
npx prisma generate

# The code graph agents query before reading files (CLAUDE.md, "graphify"). Built from the code
# alone, locally, in about ten seconds; a failure here costs the session nothing but the graph.
echo "Building the graphify code graph..."
bash scripts/graphify.sh update || echo "graphify: skipped (install or build failed)"
# The venv's graphify is linked into ~/.local/bin; put it on the session's PATH.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi

echo "Session start complete."
