#!/usr/bin/env bash
# Render homelab.d2 -> homelab.svg + homelab.png
# Requires: d2 (~/.local/bin), google-chrome (for PNG rasterization), imagemagick optional.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH"

SRC="${1:-homelab.d2}"
BASE="${SRC%.d2}"

# 1) SVG via D2 (ELK layout, neutral theme)
d2 --layout elk --theme 1 --pad 40 "$SRC" "$BASE.svg"
echo "wrote $BASE.svg"

# 2) PNG via headless Chrome at the SVG's native size, 2x for crispness
read W H < <(python3 -c "import re,sys;s=open('$BASE.svg').read();\
w=re.search(r'width=\"([0-9.]+)\"',s);h=re.search(r'height=\"([0-9.]+)\"',s);\
print(int(float(w.group(1))), int(float(h.group(1))))")
google-chrome --headless=new --no-sandbox --hide-scrollbars \
  --force-device-scale-factor=2 --window-size="${W},${H}" \
  --screenshot="$BASE.png" "file://$PWD/$BASE.svg" >/dev/null 2>&1
echo "wrote $BASE.png (${W}x${H} @2x)"
