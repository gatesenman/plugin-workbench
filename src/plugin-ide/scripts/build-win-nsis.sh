#!/usr/bin/env bash
# Cross-compile Windows NSIS installer from Linux (no working wine required).
# 1) electron-builder --win dir
# 2) embed icon.ico into PluginWorkbench.exe via resedit
# 3) makensis packs win-unpacked into setup.exe (also with Icon)
set -euo pipefail
cd "$(dirname "$0")/.."
export CSC_IDENTITY_AUTO_DISCOVERY=false

if [ ! -f vendor/code-server/lib/node.exe ]; then
  PLUGIN_IDE_SETUP_TARGET=win bash scripts/setup-ide.sh
fi
if [ ! -f build/icon.ico ]; then
  echo "Missing build/icon.ico — generate icons first"; exit 1
fi

echo "[1/4] electron-builder win dir…"
npx electron-builder --win dir --x64

EXE="dist-app/win-unpacked/PluginWorkbench.exe"
echo "[2/4] embed icon into $EXE…"
node scripts/embed-win-icon.js "$EXE" build/icon.ico
# Also copy ico next to exe for shortcut fallback
cp -f build/icon.ico dist-app/win-unpacked/PluginWorkbench.ico
node scripts/check-pe-icon.js "$EXE"

# Resolve makensis
MAKENSIS=$(command -v makensis || true)
if [ -z "$MAKENSIS" ] && [ -x /tmp/nsis-linux/usr/bin/makensis ]; then MAKENSIS=/tmp/nsis-linux/usr/bin/makensis; fi
if [ -z "$MAKENSIS" ] && [ -x "$HOME/.cache/electron-builder/nsis/nsis-3.0.4.1/linux/makensis" ]; then
  MAKENSIS="$HOME/.cache/electron-builder/nsis/nsis-3.0.4.1/linux/makensis"
fi
if [ -z "$MAKENSIS" ]; then
  echo "makensis not found. Install nsis or extract to /tmp/nsis-linux"; exit 1
fi
for d in /tmp/nsis-linux/usr/share/nsis /usr/share/nsis   "$HOME/.cache/electron-builder/nsis/nsis-3.0.4.1"   "$HOME/.cache/electron-builder/nsis/nsis-3.0.4.1/nsis"; do
  if [ -d "$d/Stubs" ]; then export NSISDIR=$d; break; fi
done
echo "[3/4] makensis ($MAKENSIS) NSISDIR=${NSISDIR:-}"

ROOT=$(pwd)
VER=$(node -p "require('$ROOT/package.json').version")
OUT="$ROOT/dist-app/PluginWorkbench-${VER}-win-x64-setup.exe"
NSI=/tmp/PluginWorkbench-build.nsi
cat > "$NSI" <<NSI
Unicode true
SetCompressor /SOLID lzma
Name "插件工坊 PluginWorkbench"
Caption "插件工坊 Setup"
OutFile "$OUT"
InstallDir "\$LOCALAPPDATA\\PluginWorkbench"
InstallDirRegKey HKCU "Software\\PluginWorkbench" "InstallDir"
RequestExecutionLevel user
Icon "$ROOT/build/icon.ico"
UninstallIcon "$ROOT/build/icon.ico"
!include "MUI2.nsh"
!define MUI_ABORTWARNING
!define MUI_ICON "$ROOT/build/icon.ico"
!define MUI_UNICON "$ROOT/build/icon.ico"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"
Section "Install"
  SetOutPath "\$INSTDIR"
  File /r "$ROOT/dist-app/win-unpacked\\*.*"
  ; Shortcuts — explicit icon file + index 0 (embedded RT_GROUP_ICON)
  CreateDirectory "\$SMPROGRAMS\\插件工坊"
  CreateShortCut "\$SMPROGRAMS\\插件工坊\\插件工坊.lnk" "\$INSTDIR\\PluginWorkbench.exe" "" "\$INSTDIR\\PluginWorkbench.exe" 0
  CreateShortCut "\$DESKTOP\\插件工坊.lnk" "\$INSTDIR\\PluginWorkbench.exe" "" "\$INSTDIR\\PluginWorkbench.exe" 0
  WriteUninstaller "\$INSTDIR\\Uninstall.exe"
  WriteRegStr HKCU "Software\\PluginWorkbench" "InstallDir" "\$INSTDIR"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PluginWorkbench" "DisplayName" "插件工坊 PluginWorkbench"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PluginWorkbench" "UninstallString" "\$\"\$INSTDIR\\Uninstall.exe\$\""
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PluginWorkbench" "DisplayIcon" "\$INSTDIR\\PluginWorkbench.exe,0"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PluginWorkbench" "Publisher" "PluginWorkbench"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PluginWorkbench" "DisplayVersion" "${VER}"
SectionEnd
Section "Uninstall"
  Delete "\$DESKTOP\\插件工坊.lnk"
  RMDir /r "\$SMPROGRAMS\\插件工坊"
  RMDir /r "\$INSTDIR"
  DeleteRegKey HKCU "Software\\PluginWorkbench"
  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PluginWorkbench"
SectionEnd
NSI

"$MAKENSIS" -V2 "$NSI"
echo "[4/4] setup.exe uses NSIS Icon directive — do not resedit (would break overlay data)"
node scripts/check-pe-icon.js "$OUT" || echo "(setup icon check soft-fail)"
ls -lah "$OUT"
sha256sum "$OUT" | tee "$OUT.sha256"
echo DONE
