#!/bin/zsh

set -u

show_error() {
  local message="$1"
  print -u2 -- "CodeCity Inspector: ${message}"
  if command -v osascript >/dev/null 2>&1; then
    osascript \
      -e 'on run argv' \
      -e 'display dialog (item 1 of argv) buttons {"OK"} default button "OK" with title "CodeCity Inspector" with icon stop' \
      -e 'end run' \
      "$message" >/dev/null 2>&1 || true
  fi
}

script_dir="${0:A:h}"
cd -- "$script_dir" || {
  show_error "CodeCity Inspectorのフォルダを開けませんでした。ZIPをもう一度展開してください。"
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  show_error "Node.js 20以上が必要です。nodejs.org からLTS版をインストールして、もう一度起動してください。"
  exit 1
fi

node_major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null)"
if [[ ! "$node_major" == <-> ]] || (( node_major < 20 )); then
  node_version="$(node --version 2>/dev/null || print -- '不明')"
  show_error "Node.js 20以上が必要です。現在のバージョン: ${node_version}"
  exit 1
fi

if ! node -e "import('@babel/parser').catch(() => process.exit(1))" >/dev/null 2>&1; then
  show_error "初回準備が済んでいません。このフォルダでターミナルを開き、npm install を実行してから、もう一度起動してください。CodeCity Inspectorが自動でダウンロードすることはありません。"
  exit 1
fi

if (( $# > 1 )); then
  show_error "一度に点検できるフォルダは1つです。リポジトリのフォルダを1つだけドラッグしてください。"
  exit 1
fi

repo_path="${1:-${script_dir}/sample/tiny-town}"
if [[ ! -d "$repo_path" ]]; then
  show_error "点検するフォルダが見つかりません: ${repo_path}"
  exit 1
fi

print -- "CodeCity Inspectorを起動します。"
print -- "終了するときは、このターミナルで Control + C を押してください。"
exec node src/server.mjs --repo "$repo_path" --open
