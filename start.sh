#!/usr/bin/env bash
# PokéBonk 离线版 · macOS / Linux 启动脚本
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js，请先安装：https://nodejs.org/"
  exit 1
fi
node serve.js --open
