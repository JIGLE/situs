#!/bin/bash
set -euo pipefail

# Only run in remote Claude Code on the web environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel)}"

echo "Installing npm dependencies..."
# `ci`, not `install`: `npm install` REWRITES package-lock.json, and npm 10 writes it back without
# the `libc` fields that only the four @next/swc-linux-* packages carry. Every session on a machine
# where corepack has not honoured the npm 11 pin then starts with a corrupted lockfile in the working
# tree, which looks like ordinary churn in a diff and has been committed by accident before.
# `npm ci` installs FROM the lockfile and never writes to it, so the corruption cannot happen
# regardless of which npm is running.
npm ci --ignore-scripts

echo "Generating Prisma client..."
npx prisma generate

echo "Session start complete."
