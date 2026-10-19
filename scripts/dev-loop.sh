#!/usr/bin/env bash
# Make It Ship 개발 루프: 반복마다 새 claude 세션으로 docs/LOOP_PROMPT.md 를 실행한다.
# 사용: scripts/dev-loop.sh [최대반복=150]   중지: touch .dev-loop/STOP
set -euo pipefail
cd "$(dirname "$0")/.."
MAX=${1:-150}
mkdir -p .dev-loop
export DISABLE_OMC=1   # 다른 플러그인의 키워드 훅이 반복마다 끼어들지 않게

ALLOWED='Read,Write,Edit,Glob,Grep,Bash(node *),Bash(npm test*),Bash(npm run *),Bash(git status*),Bash(git diff*),Bash(git log*),Bash(git add *),Bash(git commit *),Bash(git restore *),Bash(git tag *),Bash(git show *),Bash(git rev-parse *),Bash(git init *),Bash(git -C *),Bash(ls *),Bash(cat *),Bash(head *),Bash(tail *),Bash(wc *),Bash(grep *),Bash(find *),Bash(mkdir *),Bash(cp *),Bash(mv *),Bash(rm -rf /private/tmp/*),Bash(mktemp *),Bash(chmod *),Bash(claude plugin validate *),Bash(claude -p *),Bash(xcodebuild *),Bash(xcrun *)'
DENIED='Bash(git push*),Bash(gh *),Bash(npm install*),Bash(npm i *),Bash(npm publish*)'

for i in $(seq 1 "$MAX"); do
  head -1 docs/PROGRESS.md | grep -qE '^STATUS: (DONE|HALT)' && break
  [ -f .dev-loop/STOP ] && { echo "STOP file found"; break; }
  log=".dev-loop/iter-$(printf %03d "$i").log"
  echo "[$(date '+%F %T')] iteration $i → $log"
  claude -p "$(cat docs/LOOP_PROMPT.md)" \
    --permission-mode acceptEdits \
    --allowedTools "$ALLOWED" --disallowedTools "$DENIED" \
    --max-turns 120 > "$log" 2>&1 || echo "  (claude exited non-zero)"
  tail -3 "$log"
done
echo "== $(head -1 docs/PROGRESS.md)"
