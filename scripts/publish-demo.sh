#!/usr/bin/env bash
# Builds the web app and publishes ONLY the static build to the public demo repo (GitHub Pages).
# Source stays in this private repo. Requires: gh CLI logged in, contracts deployed.
set -euo pipefail

OWNER="${DEMO_OWNER:-$(gh api user --jq .login)}"
REPO="${DEMO_REPO:-orb-otc-demo}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if grep -q '0x0000000000000000000000000000000000000000' "$ROOT/web/src/deployment.json"; then
  echo "Contracts are not deployed yet (web/src/deployment.json). Run: npm run deploy:testnet" >&2
  exit 1
fi

(cd "$ROOT/web" && npm install --no-audit --no-fund && npm run build)

if ! gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  gh repo create "$OWNER/$REPO" --public --description "ORB OTC demo (Orbinum testnet)" >/dev/null
fi

TMP="$(mktemp -d)"
git clone -q "https://github.com/$OWNER/$REPO.git" "$TMP" 2>/dev/null || git init -q -b main "$TMP"
cd "$TMP"
git config core.longpaths true
git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$OWNER/$REPO.git"
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -r "$ROOT/web/dist/." .
touch .nojekyll
printf '# ORB.OTC demo\n\nTestnet-only demo build of ORB.OTC (Orbinum testnet, chain 2700).\n' > README.md
git add -A
git -c user.name="$OWNER" -c user.email="$OWNER@users.noreply.github.com" commit -q -m "Publish demo build" || { echo "No changes to publish."; exit 0; }
git branch -M main
git push -q -u origin main

gh api -X POST "repos/$OWNER/$REPO/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 || true
echo "Published: https://$OWNER.github.io/$REPO/"
