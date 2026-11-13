#!/usr/bin/env bash
# graphify: a knowledge graph of this repository (graphify-out/) that an agent queries instead of
# reading files one by one: `graphify query "<question>"`, `graphify explain "<thing>"`,
# `graphify path "<A>" "<B>"`. CLAUDE.md says when to use it.
#
# Code only, built locally with tree-sitter: no LLM backend is ever called (GRAPHIFY_BACKEND=none),
# so nothing leaves the machine and a rebuild costs nothing. graphify-out/ is gitignored and rebuilt
# where it is used: at the start of a cloud session (.claude/hooks/session-start.sh), after a
# commit, merge or checkout (.husky/), and on `npm run graph`.
#
#   scripts/graphify.sh install       install the pinned version (a private venv, linked on PATH)
#   scripts/graphify.sh update        install if missing, then rebuild what changed (about 10 s)
#   scripts/graphify.sh refresh       rebuild only if graphify is already installed; never installs
#   scripts/graphify.sh hook-guard …  Claude Code's PreToolUse nudge; does nothing when not installed
#   scripts/graphify.sh <anything>    passed to graphify (query, explain, path, …)
set -euo pipefail

VERSION="0.9.108"
VENV="${GRAPHIFY_HOME:-$HOME/.cache/situs-graphify}/$VERSION"
BIN_DIR="$HOME/.local/bin"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export GRAPHIFY_BACKEND=none
export GRAPHIFY_QUERY_LOG_DISABLE=1

find_bin() {
  if command -v graphify >/dev/null 2>&1; then
    command -v graphify
  elif [ -x "$VENV/bin/graphify" ]; then
    echo "$VENV/bin/graphify"
  fi
}

install() {
  if [ ! -x "$VENV/bin/graphify" ]; then
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install --quiet --disable-pip-version-check "graphifyy==$VERSION"
  fi
  mkdir -p "$BIN_DIR"
  ln -sf "$VENV/bin/graphify" "$BIN_DIR/graphify"
}

cmd="${1:-update}"
case "$cmd" in
  install)
    install
    ;;
  update | refresh)
    bin="$(find_bin)"
    if [ -z "$bin" ]; then
      [ "$cmd" = "refresh" ] && exit 0
      install
      bin="$VENV/bin/graphify"
    fi
    cd "$ROOT"
    "$bin" update . >/dev/null
    echo "graphify: graph rebuilt in graphify-out/"
    ;;
  hook-guard)
    bin="$(find_bin)"
    [ -z "$bin" ] && exit 0
    shift
    exec "$bin" hook-guard "$@"
    ;;
  *)
    bin="$(find_bin)"
    if [ -z "$bin" ]; then
      install
      bin="$VENV/bin/graphify"
    fi
    cd "$ROOT"
    exec "$bin" "$@"
    ;;
esac
