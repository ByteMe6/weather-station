#!/bin/bash
# PreToolUse(Edit|Write): block edits to files that hold real secrets.
# .env.example / secrets.ini.example templates stay editable.
f=$(node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log((j.tool_input&&j.tool_input.file_path)||'')}catch{/* malformed input -> skip */}})")
[ -n "$f" ] || exit 0
base=$(basename "$f")
case "$base" in
  .env.example | secrets.ini.example) exit 0 ;;
  .env | .env.* | secrets.ini)
    echo "Blocked: $f holds real secrets (CLAUDE.md env rules). Ask the user to edit it manually; update the matching .example file instead if documenting a new variable." >&2
    exit 2
    ;;
esac
exit 0
