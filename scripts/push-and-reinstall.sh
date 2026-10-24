#!/usr/bin/env bash
#
# 推送代码到 origin，并把本插件重装进当前 DSH profile。
#
# 解决的问题（历史踩坑）：
#   1. PATH 里的 `dsh` 可能很旧（本机曾解析到 0.1.2-alpha.2），必须用桌面应用
#      自带的 CLI：/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh
#   2. `dsh plugin install` 不会重新解析 git ref —— 依赖规格是 `github:…#master`
#      时，pnpm 认为 lock 已满足，什么都不做；必须用 `pnpm update <包名>`。
#   3. 只改 profile 的 dependencies 不会让宿主加载插件：`dsh.profile.bundles`
#      里也必须出现包名（本脚本会校验并补齐）。
#
# 用法：
#   bash scripts/push-and-reinstall.sh                     # 构建 + push master + 重装 desktop
#   bash scripts/push-and-reinstall.sh --dry-run           # 只打印参数与将要执行的命令
#   bash scripts/push-and-reinstall.sh --profile web       # 换 profile
#   bash scripts/push-and-reinstall.sh --ref feat/x --no-push   # 远端已有分支，只重装
#   bash scripts/push-and-reinstall.sh --no-build          # 跳过 typecheck/build
#
# 注意：写 ~/.dsh/profile 需要文件权限；在 DSH 沙箱里跑会把命令报成
# `sandbox: file access denied`，用 danger-full-access 审批重试同一条命令即可。

set -euo pipefail

PROFILE="${DSH_PROFILE:-desktop}"
REF="master"
REMOTE="origin"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
DSH_CLI="${DSH_CLI:-/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh}"
DO_PUSH=1
DO_INSTALL=1
DO_BUILD=1
DRY_RUN=0
FORCE=0
FORCE_REINSTALL=0

usage() {
  cat <<'EOF'
推送本插件并重装进 DSH profile。

Options:
  --profile <name>     profile 名（默认 desktop；也可用 DSH_PROFILE）
  --ref <ref>          要推送/安装的 git ref（默认 master）
  --remote <name>      git remote（默认 origin）
  --dsh-home <dir>     DSH_HOME（默认 $DSH_HOME 或 ~/.dsh）
  --dsh-cli <path>     dsh CLI 路径（默认桌面应用自带 CLI）
  --no-push            不推送，只重装（要求远端已有该 ref）
  --no-install         只推送，不重装
  --no-build           跳过 pnpm typecheck/build
  --force-reinstall    pnpm update 未解析到远端提交时，执行 remove + add 强刷
  --force              允许工作区不干净（不推荐）
  --dry-run            只打印参数与计划执行的命令，不做任何写入
  -h, --help           显示本帮助
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:?--profile 需要参数}"; shift 2 ;;
    --ref) REF="${2:?--ref 需要参数}"; shift 2 ;;
    --remote) REMOTE="${2:?--remote 需要参数}"; shift 2 ;;
    --dsh-home) DSH_HOME_DIR="${2:?--dsh-home 需要参数}"; shift 2 ;;
    --dsh-cli) DSH_CLI="${2:?--dsh-cli 需要参数}"; shift 2 ;;
    --no-push) DO_PUSH=0; shift ;;
    --no-install) DO_INSTALL=0; shift ;;
    --no-build) DO_BUILD=0; shift ;;
    --force-reinstall) FORCE_REINSTALL=1; shift ;;
    --force) FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }
run() {
  if [ "$DRY_RUN" = 1 ]; then
    say "  [dry-run] $*"
  else
    "$@"
  fi
}

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || die "当前目录不是 git 仓库"
cd "$ROOT"

NAME=$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).name")
VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version")
PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE"
LOCK="$PROFILE_DIR/pnpm-lock.yaml"
REMOTE_URL=$(git remote get-url "$REMOTE" 2>/dev/null) || die "找不到 remote: $REMOTE"
OWNER_REPO=$(printf '%s' "$REMOTE_URL" | sed -E 's#.*github\.com[:/]##; s#\.git$##')
case "$OWNER_REPO" in
  */*) ;;
  *) die "无法从 remote URL 解析 owner/repo: $REMOTE_URL" ;;
esac
TARGET_SPEC="github:$OWNER_REPO#$REF"

# 读 profile 当前依赖规格（没有则空串）。
read_spec() {
  PROFILE_DIR="$PROFILE_DIR" PKG_NAME="$NAME" node -e '
    const fs = require("fs");
    const file = process.env.PROFILE_DIR + "/package.json";
    const m = JSON.parse(fs.readFileSync(file, "utf8"));
    process.stdout.write((m.dependencies && m.dependencies[process.env.PKG_NAME]) || "");
  '
}

# 从 profile lock 里取已安装的 git commit。
read_installed_sha() {
  if [ ! -f "$LOCK" ]; then
    return 0
  fi
  grep -o "codeload\.github\.com/$OWNER_REPO/tar\.gz/[0-9a-f]\{40\}" "$LOCK" 2>/dev/null \
    | head -n 1 | sed -E 's#.*/##' || true
}

echo "================ 参数 ================"
say "仓库            : $ROOT"
say "包名 / 版本     : $NAME @ $VERSION"
say "remote / ref    : $REMOTE ($REMOTE_URL) / $REF"
say "安装 spec       : $TARGET_SPEC"
say "profile         : $PROFILE"
say "profile 目录    : $PROFILE_DIR"
say "DSH_HOME        : $DSH_HOME_DIR"
say "dsh CLI         : $DSH_CLI"
if [ -x "$DSH_CLI" ]; then
  CLI_VERSION=$("$DSH_CLI" --version 2>/dev/null | tail -n 1 || true)
  say "dsh CLI 版本    : ${CLI_VERSION:-unknown}"
  case "$CLI_VERSION" in
    0.1.*) die "CLI 版本过旧（${CLI_VERSION}）：PATH 里的 dsh 可能是旧的；请用桌面应用自带 CLI（默认值），或 --dsh-cli 指定" ;;
  esac
elif [ "$DRY_RUN" = 1 ]; then
  say "dsh CLI 版本    : (不可执行，dry-run 继续)"
else
  die "dsh CLI 不可执行: ${DSH_CLI}（用 --dsh-cli 指定桌面应用自带 CLI）"
fi
say "工作区          : $(git status --porcelain | wc -l | tr -d ' ') 个未提交文件"
say "构建            : $([ "$DO_BUILD" = 1 ] && echo 'pnpm typecheck + pnpm build' || echo '跳过')"
say "推送            : $([ "$DO_PUSH" = 1 ] && echo "git push $REMOTE $REF" || echo '跳过')"
say "重装            : $([ "$DO_INSTALL" = 1 ] && echo "dsh plugin --profile $PROFILE …" || echo '跳过')"

if [ ! -d "$PROFILE_DIR" ]; then
  die "profile 目录不存在: $PROFILE_DIR"
fi
CURRENT_SPEC=$(read_spec)
INSTALLED_SHA=$(read_installed_sha)
say "当前 profile 规格: ${CURRENT_SPEC:-<未安装>}"
say "已安装 commit   : ${INSTALLED_SHA:-<未知>}"
echo "======================================"

# 1) 工作区检查（clean 才能保证推送/构建可复现）
if [ -n "$(git status --porcelain)" ] && [ "$FORCE" = 0 ]; then
  git status --short | sed 's/^/  /'
  die "工作区不干净：先提交，或加 --force 明确跳过"
fi

if [ "$DO_PUSH" = 1 ]; then
  git rev-parse --verify "refs/heads/$REF" >/dev/null 2>&1 \
    || die "本地没有分支 ${REF}（先 git checkout/$REF 或换 --ref）"
  LOCAL_SHA=$(git rev-parse "$REF")
  say ""
  say "== 推送 =="
  say "本地 $REF = $LOCAL_SHA"
  run git push "$REMOTE" "$REF"
else
  LOCAL_SHA=$(git rev-parse --verify "refs/heads/$REF" 2>/dev/null || true)
fi

REMOTE_SHA=$(git ls-remote "$REMOTE" "refs/heads/$REF" 2>/dev/null | awk '{print $1}' | head -n 1)
if [ -z "$REMOTE_SHA" ]; then
  die "远端没有 $REMOTE/${REF}（先推送，或去掉 --no-push）"
fi
if [ -n "${LOCAL_SHA:-}" ] && [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  say "⚠ 本地 $REF ($LOCAL_SHA) 与远端 ($REMOTE_SHA) 不一致；安装将使用远端提交"
fi
say "远端 $REF = $REMOTE_SHA"

# 2) 构建：确保 lib/** 与 src 一致后再推送（lib 是 git 安装的产物）
if [ "$DO_BUILD" = 1 ]; then
  say ""
  say "== 构建 =="
  run pnpm typecheck
  run pnpm build
  if [ "$DRY_RUN" = 0 ] && [ -n "$(git status --porcelain)" ]; then
    git status --short | sed 's/^/  /'
    die "构建改动了工作区（lib 落后于 src？）：先提交这次构建产物再重试"
  fi
fi

# 3) 重装
if [ "$DO_INSTALL" = 1 ]; then
  say ""
  say "== 重装到 profile: $PROFILE =="
  if [ "$CURRENT_SPEC" = "" ]; then
    say "> 未安装：pnpm add $TARGET_SPEC"
    run "$DSH_CLI" plugin --profile "$PROFILE" add "$TARGET_SPEC"
  elif [ "$REMOTE_SHA" = "$INSTALLED_SHA" ] && [ "$FORCE_REINSTALL" = 0 ]; then
    say "> 已是最新（${INSTALLED_SHA}），跳过重装"
  else
    say "> 已安装：pnpm update ${NAME}（重新解析 ${REF}）"
    run "$DSH_CLI" plugin --profile "$PROFILE" update "$NAME"
    NEW_SHA=$(read_installed_sha)
    if [ "$DRY_RUN" = 0 ] && [ "$NEW_SHA" != "$REMOTE_SHA" ]; then
      if [ "$FORCE_REINSTALL" = 1 ]; then
        say "⚠ update 后仍是 ${NEW_SHA:-<未知>}，按 --force-reinstall 执行 remove + add"
        run "$DSH_CLI" plugin --profile "$PROFILE" remove "$NAME"
        run "$DSH_CLI" plugin --profile "$PROFILE" add "$TARGET_SPEC"
      else
        say "⚠ update 后仍是 ${NEW_SHA:-<未知>}（期望 ${REMOTE_SHA}）"
        say "  可加 --force-reinstall 走 remove + add 强刷"
      fi
    fi
  fi

  # 3.1) 确保 dsh.profile.bundles 含包名（否则宿主不会加载插件）
  if [ "$DRY_RUN" = 0 ]; then
    PROFILE_DIR="$PROFILE_DIR" PKG_NAME="$NAME" node -e '
      const fs = require("fs");
      const file = process.env.PROFILE_DIR + "/package.json";
      const m = JSON.parse(fs.readFileSync(file, "utf8"));
      const name = process.env.PKG_NAME;
      m.dsh = m.dsh || {};
      m.dsh.profile = m.dsh.profile || {};
      const bundles = Array.isArray(m.dsh.profile.bundles) ? m.dsh.profile.bundles : (m.dsh.profile.bundles = []);
      if (!bundles.includes(name)) {
        bundles.push(name);
        fs.writeFileSync(file, JSON.stringify(m, null, 2) + "\n");
        console.log("> bundles 已补入 " + name);
      } else {
        console.log("> bundles 已包含 " + name);
      }
    '
    NEW_SHA=$(read_installed_sha)
    INSTALLED_VERSION=$(node -p "require('$PROFILE_DIR/node_modules/$NAME/package.json').version" 2>/dev/null || true)
    PATCH_NAME=$(grep -o "name:.*" "$PROFILE_DIR/node_modules/$NAME/cordis.patch.yml" 2>/dev/null | tail -n 1 | sed -E "s/.*'([^']+)'.*/\1/" || true)
    echo ""
    say "已安装 commit   : ${NEW_SHA:-<未知>}"
    say "已安装版本      : ${INSTALLED_VERSION:-<未知>}"
    say "patch insert 名 : ${PATCH_NAME:-<未知>}"
    if [ -n "$NEW_SHA" ] && [ "$NEW_SHA" != "$REMOTE_SHA" ]; then
      say "⚠ 安装后 commit 与远端不一致"
    fi
  fi
fi

say ""
say "✔ 完成。重启 DeepSeek Harness（或它提示的重启入口）后宿主才会加载新代码；"
say "  客户端页面刷新即可看到新 bundle。"
