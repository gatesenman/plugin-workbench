#!/usr/bin/env bash
# 下载并品牌化内嵌代码编辑器：
#   Linux/macOS → OpenVSCode Server
#   Windows     → code-server（OpenVSCode Server 无官方 Windows 构建）
# 设置 PLUGIN_IDE_SETUP_TARGET=win|linux|all（默认按本机平台）；Windows 打包时从 Linux 交叉编译请用 all 或 win。
set -euo pipefail
cd "$(dirname "$0")/.."
OVS_VERSION=${OVS_VERSION:-v1.94.2}
CS_VERSION=${CS_VERSION:-4.141.0}
TARGET=${PLUGIN_IDE_SETUP_TARGET:-}
if [ -z "$TARGET" ]; then
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*|Windows_NT) TARGET=win ;;
    *) TARGET=linux ;;
  esac
fi

brand_ovs() {
  node -e "
    const f='vendor/openvscode-server/product.json', fs=require('fs');
    const j=JSON.parse(fs.readFileSync(f,'utf8'));
    Object.assign(j,{nameShort:'PluginWorkbench',nameLong:'插件工坊 · PluginWorkbench',applicationName:'plugin-workbench'});
    fs.writeFileSync(f, JSON.stringify(j,null,1));
  "
  rm -rf vendor/openvscode-server/extensions/plugin-ide-bridge
  cp -r extensions/plugin-ide-bridge vendor/openvscode-server/extensions/
}

setup_linux() {
  if [ -x vendor/openvscode-server/bin/openvscode-server ] && [ -f vendor/openvscode-server/out/server-main.js ] && [ -x vendor/openvscode-server/node ]; then
    echo "[setup] OpenVSCode Server already present (integrity OK)"; brand_ovs; return
  fi
  if [ -d vendor/openvscode-server ]; then
    echo "[setup] OpenVSCode Server incomplete (missing out/server-main.js or node) → re-downloading"
    rm -rf vendor/openvscode-server
  fi
  mkdir -p vendor
  local arch=${OVS_ARCH:-linux-x64}
  echo "[setup] downloading OpenVSCode Server $OVS_VERSION ($arch)…"
  curl -fsSL "https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-$OVS_VERSION/openvscode-server-$OVS_VERSION-$arch.tar.gz" \
    | tar xz -C vendor
  rm -rf vendor/openvscode-server
  mv "vendor/openvscode-server-$OVS_VERSION-$arch" vendor/openvscode-server
  if [ ! -f vendor/openvscode-server/out/server-main.js ]; then echo "[setup] ERROR: integrity check failed (out/server-main.js missing)"; exit 2; fi
  brand_ovs
  echo "[setup] OpenVSCode Server ready (integrity OK)"
}

setup_win() {
  if [ -f vendor/code-server/bin/code-server.cmd ] || [ -f vendor/code-server/node_modules/.bin/code-server.cmd ] || [ -f vendor/code-server/code-server.cmd ]; then
    # normalize layout after extract
    :
  fi
  if [ -x vendor/code-server/bin/code-server ] || [ -f vendor/code-server/bin/code-server.cmd ] || [ -f vendor/code-server/lib/node.exe ]; then
    echo "[setup] code-server (Windows) already present"
    # still copy bridge extension if any
    mkdir -p vendor/code-server/extensions
    rm -rf vendor/code-server/extensions/plugin-ide-bridge
    cp -r extensions/plugin-ide-bridge vendor/code-server/extensions/ 2>/dev/null || true
    return
  fi
  mkdir -p vendor
  local tmp="vendor/.cs-win-tmp"
  rm -rf "$tmp" vendor/code-server
  mkdir -p "$tmp"
  echo "[setup] downloading code-server $CS_VERSION (windows-amd64)…"
  curl -fsSL "https://github.com/coder/code-server/releases/download/v$CS_VERSION/code-server-$CS_VERSION-windows-amd64.tar.gz" \
    | tar xz -C "$tmp"
  # tarball contains a single top-level dir
  local top
  top=$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -1)
  mv "$top" vendor/code-server
  rm -rf "$tmp"
  mkdir -p vendor/code-server/extensions
  cp -r extensions/plugin-ide-bridge vendor/code-server/extensions/
  # brand: write a tiny product overlay note (code-server uses its own product.json)
  if [ -f vendor/code-server/lib/vscode/product.json ]; then
    node -e "
      const f='vendor/code-server/lib/vscode/product.json', fs=require('fs');
      try {
        const j=JSON.parse(fs.readFileSync(f,'utf8'));
        Object.assign(j,{nameShort:'PluginWorkbench',nameLong:'插件工坊 · PluginWorkbench',applicationName:'plugin-workbench'});
        fs.writeFileSync(f, JSON.stringify(j,null,1));
      } catch(e) { console.warn(e.message); }
    " || true
  fi
  echo "[setup] code-server (Windows) ready"
}

case "$TARGET" in
  linux) setup_linux ;;
  win|windows) setup_win ;;
  all) setup_linux; setup_win ;;
  *) echo "unknown TARGET=$TARGET"; exit 1 ;;
esac
echo "embedded IDE ready (target=$TARGET)"
