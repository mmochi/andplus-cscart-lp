#!/usr/bin/env bash
# VPS 上で初回のみ: /var/www/apps.andplus.tech/cscart に git clone する。
#
# 手元の PC（SSH 鍵が通る端末）から例:
#   scp deploy/vps-init.sh mmochi@apps.andplus.tech:/tmp/
#   ssh mmochi@apps.andplus.tech 'bash /tmp/vps-init.sh'
#
# またはサーバーにログインしてから:
#   bash /tmp/vps-init.sh
#
# 環境変数:
#   REPO_URL   既定: https://github.com/mmochi/andplus-cscart-lp.git
#   RUN_NPM_CI 既定: 1（0 で npm ci をスキップ）
set -euo pipefail

ROOT="/var/www/apps.andplus.tech"
CLONE_DIR="$ROOT/cscart"
REPO_URL="${REPO_URL:-https://github.com/mmochi/andplus-cscart-lp.git}"
RUN_NPM_CI="${RUN_NPM_CI:-1}"

if [[ "$(id -u)" -eq 0 ]]; then
  OWNER="${SUDO_USER:-}"
  if [[ -z "$OWNER" ]]; then
    echo "root のまま実行しないでください。次のようにログインユーザー経由で sudo してください:" >&2
    echo "  ssh mmochi@apps.andplus.tech 'bash -s' < deploy/vps-init.sh" >&2
    echo "または: sudo -u mmochi bash $0" >&2
    exit 1
  fi
else
  OWNER="$(id -un)"
fi

have_sudo=""
if command -v sudo >/dev/null 2>&1; then
  if sudo -n true 2>/dev/null; then
    have_sudo=1
  fi
fi

run_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif [[ -n "$have_sudo" ]]; then
    sudo "$@"
  else
    echo "sudo が必要です（/var/www 配下のため）。" >&2
    exit 1
  fi
}

run_sudo mkdir -p "$ROOT"

if [[ -d "$CLONE_DIR/.git" ]]; then
  echo "既にあります: $CLONE_DIR — git pull します"
  run_sudo git -C "$CLONE_DIR" pull --ff-only
elif [[ -e "$CLONE_DIR" ]]; then
  echo "エラー: $CLONE_DIR はありますが git リポジトリではありません。退避してから再実行してください。" >&2
  exit 1
else
  echo "clone: $REPO_URL -> $CLONE_DIR"
  run_sudo git clone --no-recurse-submodules "$REPO_URL" "$CLONE_DIR"
fi

run_sudo chown -R "$OWNER:$OWNER" "$CLONE_DIR"

if [[ "$RUN_NPM_CI" == "1" ]] && command -v npm >/dev/null 2>&1; then
  echo "npm ci ..."
  if [[ "$(id -u)" -eq 0 ]]; then
    sudo -u "$OWNER" bash -c "cd '$CLONE_DIR' && npm ci"
  else
    (cd "$CLONE_DIR" && npm ci)
  fi
elif [[ "$RUN_NPM_CI" == "1" ]]; then
  echo "WARN: npm が無いので npm ci をスキップしました。Node 18+ を入れてから手動で cd $CLONE_DIR && npm ci" >&2
fi

if [[ ! -f "$CLONE_DIR/.env" ]] && [[ -f "$CLONE_DIR/.env.example" ]]; then
  if [[ "$(id -u)" -eq 0 ]]; then
    sudo -u "$OWNER" cp -a "$CLONE_DIR/.env.example" "$CLONE_DIR/.env"
    sudo -u "$OWNER" chmod 600 "$CLONE_DIR/.env"
  else
    cp -a "$CLONE_DIR/.env.example" "$CLONE_DIR/.env"
    chmod 600 "$CLONE_DIR/.env" 2>/dev/null || true
  fi
  echo "作成: $CLONE_DIR/.env（PORT / Freemius 等を編集）"
fi

echo ""
echo "完了: $CLONE_DIR"
echo "次: nano $CLONE_DIR/.env および deploy/VPS.md の systemd / nginx"
