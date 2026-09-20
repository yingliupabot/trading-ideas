#!/bin/bash
# Claude Code on the web 会话启动时自动装依赖,让 playwright 开箱即用。
set -euo pipefail

# 只管云端。本地开发机不干预,免得每次开 Claude Code 都替你跑 npm install
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$PROJECT_DIR"

# 云端镜像已预装 Chromium(见 PLAYWRIGHT_BROWSERS_PATH),禁止 npm 再下一份:
# 出网是白名单,下载必然被网络策略挡住,还会拖慢启动
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

npm install --no-audit --no-fund

# 传给本次会话的后续命令,否则手动跑 npm install 时又会去下载浏览器
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1' >> "$CLAUDE_ENV_FILE"
fi

echo "session-start: 依赖就绪,playwright 可直接使用"
