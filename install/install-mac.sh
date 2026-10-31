#!/bin/bash
# Installs Multi-Session Browser on macOS. Picks the Apple Silicon (M series)
# or Intel build automatically.
#
#   curl -fsSL https://raw.githubusercontent.com/ibrahim18-selise/multi-session-browser/main/install/install-mac.sh | bash
#
# Options (set before "bash"):
#   MSB_ARCH=arm64 or MSB_ARCH=x64   force a build instead of auto-detecting
#   MSB_VERSION=2.0.1                 install a specific version instead of the latest
set -euo pipefail

REPO="ibrahim18-selise/multi-session-browser"
APP_NAME="Multi-Session Browser"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This installer is for macOS. On Windows, use install-windows.ps1." >&2
  exit 1
fi

MACOS_MAJOR="$(sw_vers -productVersion | cut -d. -f1)"
if [ "$MACOS_MAJOR" -lt 11 ]; then
  echo "Multi-Session Browser needs macOS 11 Big Sur or newer. This Mac has $(sw_vers -productVersion)." >&2
  exit 1
fi

ARCH="${MSB_ARCH:-}"
if [ -z "$ARCH" ]; then
  case "$(uname -m)" in
    arm64) ARCH="arm64" ;;
    x86_64)
      # A Terminal running under Rosetta on an M series Mac still gets the native build.
      if [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then ARCH="arm64"; else ARCH="x64"; fi ;;
    *) echo "Unsupported Mac processor: $(uname -m)" >&2; exit 1 ;;
  esac
fi
case "$ARCH" in
  arm64) LABEL="Apple Silicon (M series)" ;;
  x64) LABEL="Intel" ;;
  *) echo "MSB_ARCH must be arm64 or x64." >&2; exit 1 ;;
esac

if [ -n "${MSB_VERSION:-}" ]; then
  URL="https://github.com/$REPO/releases/download/v$MSB_VERSION/Multi-Session-Browser-$MSB_VERSION-mac-$ARCH.dmg"
else
  URL="https://github.com/$REPO/releases/latest/download/Multi-Session-Browser-mac-$ARCH.dmg"
fi

if [ -w /Applications ]; then DEST="/Applications"; else DEST="$HOME/Applications"; mkdir -p "$DEST"; fi

TMP="$(mktemp -d)"
MNT="$TMP/mount"
cleanup() {
  hdiutil detach "$MNT" -quiet >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "Downloading Multi-Session Browser for $LABEL Macs"
curl -fL --progress-bar -o "$TMP/app.dmg" "$URL"

mkdir -p "$MNT"
hdiutil attach "$TMP/app.dmg" -nobrowse -readonly -noautoopen -mountpoint "$MNT" -quiet

osascript -e "quit app \"$APP_NAME\"" >/dev/null 2>&1 || true

echo "Installing to $DEST"
rm -rf "$DEST/$APP_NAME.app"
ditto "$MNT/$APP_NAME.app" "$DEST/$APP_NAME.app"

# The app is not notarized yet. Clearing the quarantine flag and adding a
# local signature lets macOS open it without the "damaged" warning.
xattr -cr "$DEST/$APP_NAME.app" 2>/dev/null || true
codesign --force --deep --sign - "$DEST/$APP_NAME.app" >/dev/null 2>&1 || true

echo "Installed. Open it from Launchpad, or run: open -a \"$APP_NAME\""
