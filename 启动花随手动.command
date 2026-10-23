#!/bin/zsh
cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  print '请先安装 Node.js 20 或更新版本：https://nodejs.org/'
  read -k 1 '?按任意键关闭此窗口。'
  exit 1
fi
print '启动花随手动。请在浏览器打开 http://127.0.0.1:8786'
print '使用过程中保持这个窗口打开；按 Control-C 停止服务。'
node server.mjs
