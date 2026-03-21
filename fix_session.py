#!/usr/bin/env python3
"""
Fix Claude Code "image cannot be empty" API errors.

When an image upload fails in Claude Code, it leaves behind an empty image
block in the session's JSONL history file. This script removes those broken
entries so subsequent API calls and /compact succeed.

Usage:
    python3 fix_session.py

Update the `path` variable below to point to your session file.
Session files live in ~/.claude/projects/<project-folder>/<session-uuid>.jsonl
"""

import json

path = "/home/youruser/.claude/projects/-home-youruser-your-project/<session-uuid>.jsonl"

fixed = []
removed = 0

with open(path) as f:
    for line in f:
        msg = json.loads(line)
        content = msg.get("message", {}).get("content")
        if isinstance(content, list):
            new_content = []
            for block in content:
                if (block.get("type") == "image" and
                        block.get("source", {}).get("data", "x") == ""):
                    removed += 1
                else:
                    new_content.append(block)
            msg["message"]["content"] = new_content
        fixed.append(msg)

with open(path, "w") as f:
    for msg in fixed:
        f.write(json.dumps(msg) + "\n")

print(f"Done. Removed {removed} empty image blocks. {len(fixed)} total entries kept.")
