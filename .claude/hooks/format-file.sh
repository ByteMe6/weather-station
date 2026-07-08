#!/bin/bash
# PostToolUse(Edit|Write): format the touched file with the repo's prettier.
# Uses node (guaranteed by engines) instead of jq so every teammate's machine works.
f=$(node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log((j.tool_response&&j.tool_response.filePath)||(j.tool_input&&j.tool_input.file_path)||'')}catch{/* malformed input -> skip */}})")
[ -n "$f" ] || exit 0
case "$f" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.json | *.css | *.md | *.yml | *.yaml)
    # --ignore-unknown + .prettierignore keep generated/vendored files untouched
    npx prettier --write --ignore-unknown "$f" >/dev/null 2>&1 || true
    ;;
esac
exit 0
