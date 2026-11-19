#!/usr/bin/env bash
# OpenClaw si-release updater.
# CI stamps VERSION and REPO when this script is attached to a GitHub Release,
# so each release ships a script that installs exactly that release.
#
# Usage:  ./update.sh                    # install the stamped version from its Release
#         ./update.sh --tarball FILE.tgz # install a local build (e.g. a CI artifact under test)
#         ./update.sh --dry-run          # show what would happen (combine with the above)
#         ./update.sh --rollback         # reinstall the previously installed build
set -euo pipefail

VERSION="@VERSION@"                 # e.g. 2026.11.4-si.3  (stamped by CI)
REPO="@REPO@"                       # e.g. you/openclaw    (stamped by CI)
BUILDS_DIR="${OPENCLAW_BUILDS_DIR:-$HOME/openclaw-builds}"
BACKUP_DIR="${OPENCLAW_BACKUP_DIR:-$HOME/Backups/openclaw}"
KEEP_BUILDS="${KEEP_BUILDS:-3}"
KEEP_BACKUPS="${KEEP_BACKUPS:-3}"
MIN_FREE_GB="${MIN_FREE_GB:-10}"
HEAP_MB="${HEAP_MB:-8192}"          # extra heap for doctor's index repairs

DRY=0; MODE=install; LOCAL_TGZ=""
while (($#)); do
  case "$1" in
    --dry-run)  DRY=1 ;;
    --rollback) MODE=rollback ;;
    --tarball)  LOCAL_TGZ="${2:?--tarball needs a file}"; shift ;;
    *) echo "usage: $0 [--dry-run] [--rollback | --tarball FILE.tgz]"; exit 2 ;;
  esac
  shift
done

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }
run()  { if ((DRY)); then echo "   [dry-run] $*"; else "$@"; fi; }

if [[ -n $LOCAL_TGZ ]]; then
  [[ -f $LOCAL_TGZ ]] || die "no such file: $LOCAL_TGZ"
  LOCAL_TGZ="$(cd "$(dirname "$LOCAL_TGZ")" && pwd)/$(basename "$LOCAL_TGZ")"
  VERSION="$(tar -xOzf "$LOCAL_TGZ" package/package.json | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).version')"
  [[ -n $VERSION ]] || die "could not read version from $LOCAL_TGZ"
elif [[ $MODE == install ]]; then
  [[ "$VERSION" != @*@ && "$REPO" != @*@ ]] || die "VERSION/REPO not stamped; use the update.sh attached to a Release, or pass --tarball."
fi
command -v openclaw >/dev/null || die "openclaw not found on PATH"
command -v npm >/dev/null      || die "npm not found on PATH"

mkdir -p "$BUILDS_DIR" "$BACKUP_DIR"
CURRENT="$(openclaw --version 2>/dev/null | grep -Eo '[0-9]{4}\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?' | head -1 || true)"
STATE_FILE="$BUILDS_DIR/.previous"

# ---------- pick the target ----------
if [[ $MODE == rollback ]]; then
  [[ -f $STATE_FILE ]] || die "no previous install recorded in $STATE_FILE"
  TARGET="$(cat "$STATE_FILE")"
  log "Rolling back: $CURRENT -> $TARGET"
else
  TARGET="$VERSION"
  log "Updating: ${CURRENT:-unknown} -> $TARGET"
  if [[ "$CURRENT" == "$TARGET" ]]; then
    warn "already on $TARGET; reinstalling anyway"
  fi
fi

TGZ="$BUILDS_DIR/openclaw-$TARGET.tgz"
if [[ -n $LOCAL_TGZ && $MODE == install && $LOCAL_TGZ != "$TGZ" ]]; then
  log "Using local tarball $LOCAL_TGZ"
  run cp -f "$LOCAL_TGZ" "$TGZ"        # cache it so --rollback can find it later
  if ((! DRY)); then (cd "$BUILDS_DIR" && sha256sum "$(basename "$TGZ")" > "$(basename "$TGZ").sha256"); fi
fi

# ---------- preflight ----------
free_gb=$(df -Pk "$HOME" | awk 'NR==2{print int($4/1048576)}')
(( free_gb >= MIN_FREE_GB )) || die "only ${free_gb}G free in \$HOME (need ${MIN_FREE_GB}G)"
log "Free space: ${free_gb}G"

# ---------- fetch + verify (install mode, or rollback to an si build not cached) ----------
fetch() {
  local tag="v$TARGET"
  if command -v gh >/dev/null; then
    run gh release download "$tag" -R "$REPO" -D "$BUILDS_DIR" --clobber \
        -p "*.tgz" -p "*.sha256"
  else
    local base="https://github.com/$REPO/releases/download/$tag"
    run curl -fL --retry 3 -o "$TGZ"        "$base/openclaw-$TARGET.tgz"
    run curl -fL --retry 3 -o "$TGZ.sha256" "$base/openclaw-$TARGET.tgz.sha256"
  fi
}

if [[ $TARGET == *-si.* ]]; then
  [[ -f $TGZ || ( -n $LOCAL_TGZ && $MODE == install ) ]] || { log "Downloading $TARGET from $REPO"; fetch; }
  if ((! DRY)); then
    [[ -f $TGZ ]] || die "download failed: $TGZ missing"
    if [[ -f $TGZ.sha256 ]]; then
      (cd "$BUILDS_DIR" && sha256sum -c "$(basename "$TGZ").sha256" >/dev/null) \
        || die "checksum mismatch for $TGZ"
      log "Checksum OK"
    else
      warn "no .sha256 next to $TGZ; skipping checksum"
    fi
  fi
  INSTALL_SPEC="$TGZ"
else
  INSTALL_SPEC="openclaw@$TARGET"     # rolling back to a stock release
fi

# ---------- stop + backup ----------
log "Stopping gateway"
run openclaw gateway stop || true
if ((! DRY)); then
  for _ in {1..15}; do pgrep -f 'openclaw.*gateway' >/dev/null || break; sleep 1; done
  pgrep -af 'openclaw.*gateway' && die "gateway still running; stop it and retry"
fi

log "Backing up state (no workspace)"
run openclaw backup create --output "$BACKUP_DIR" --no-include-workspace --verify

# ---------- install ----------
[[ -n "$CURRENT" && $MODE == install ]] && ((! DRY)) && echo "$CURRENT" > "$STATE_FILE"

log "Installing $INSTALL_SPEC"
run npm install -g --allow-scripts=openclaw "$INSTALL_SPEC"

# npm skips lifecycle scripts for local tarballs; run the one that matters.
PKG_DIR="$(npm root -g)/openclaw"
if [[ -f "$PKG_DIR/scripts/postinstall-bundled-plugins.mjs" ]]; then
  log "Running bundled-plugin postinstall"
  run bash -c "cd '$PKG_DIR' && node scripts/postinstall-bundled-plugins.mjs"
fi

# ---------- migrate + restart ----------
rollback_hint() {
  warn "Step failed. Roll back with:  $0 --rollback"
  warn "Or restore state from the newest archive in $BACKUP_DIR"
}
trap rollback_hint ERR

log "doctor --fix (may take a while on first run after upgrade)"
run env NODE_OPTIONS="--max-old-space-size=$HEAP_MB" openclaw doctor --fix
run openclaw gateway install --force
run openclaw gateway start
log "Gateway status"
run openclaw gateway status --deep
trap - ERR

if ((! DRY)); then
  NOW="$(openclaw --version 2>/dev/null | grep -Eo '[0-9]{4}\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?' | head -1)"
  [[ "$NOW" == "$TARGET" ]] || warn "openclaw --version reports '$NOW', expected '$TARGET'"
fi

# ---------- housekeeping ----------
prune() { # dir glob keep
  local d=$1 g=$2 k=$3
  ls -1t "$d"/$g 2>/dev/null | tail -n +$((k+1)) | while read -r f; do run rm -f -- "$f" "$f.sha256"; done
}
prune "$BUILDS_DIR" 'openclaw-*.tgz' "$KEEP_BUILDS"
prune "$BACKUP_DIR" '*openclaw-backup*.tar.gz' "$KEEP_BACKUPS"

log "Done: now on $TARGET (previous: ${CURRENT:-unknown}). Rollback: $0 --rollback"
