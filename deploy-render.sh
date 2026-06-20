#!/usr/bin/env bash
# One-shot deploy: publish ticash-pay to a public GitHub repo, then create a
# Render web service from it (Docker, in-memory, seeded, Basic Auth).
#
# Run from the ticash-pay/ folder with these env vars set:
#   GITHUB_USER     your github username
#   GITHUB_TOKEN    a GitHub PAT with "repo" scope  (github.com/settings/tokens)
#   RENDER_API_KEY  a Render API key                 (dashboard → Account → API Keys)
# Optional:
#   REPO_NAME       default: ticash-pay-demo
#   BASIC_AUTH_PASS default: demo2026
#
# Example:
#   GITHUB_USER=you GITHUB_TOKEN=ghp_xxx RENDER_API_KEY=rnd_xxx bash deploy-render.sh
set -euo pipefail

REPO_NAME="${REPO_NAME:-ticash-pay-demo}"
BASIC_AUTH_USER="${BASIC_AUTH_USER:-ticash}"
BASIC_AUTH_PASS="${BASIC_AUTH_PASS:-demo2026}"
: "${GITHUB_USER:?set GITHUB_USER}"
: "${GITHUB_TOKEN:?set GITHUB_TOKEN}"

GH_API="https://api.github.com"
RN_API="https://api.render.com/v1"
hdr_gh=(-H "Authorization: token ${GITHUB_TOKEN}" -H "Accept: application/vnd.github+json")

echo "==> 1/4 ensure GitHub repo ${GITHUB_USER}/${REPO_NAME} (public)"
code=$(curl -s -o /tmp/gh_repo.json -w "%{http_code}" "${hdr_gh[@]}" "${GH_API}/repos/${GITHUB_USER}/${REPO_NAME}")
if [ "$code" = "404" ]; then
  curl -s -o /tmp/gh_create.json -w "create: %{http_code}\n" "${hdr_gh[@]}" \
    -X POST "${GH_API}/user/repos" \
    -d "{\"name\":\"${REPO_NAME}\",\"private\":false,\"description\":\"Ticash Pay — Phase 1 demo\"}"
else
  echo "repo already exists (HTTP $code), reusing"
fi

echo "==> 2/4 commit + push"
git add -A
git -c user.email="${GITHUB_USER}@users.noreply.github.com" -c user.name="${GITHUB_USER}" \
  commit -q -m "Ticash Pay — Phase 1 deploy" || echo "(nothing new to commit)"
git branch -M main
git remote remove origin 2>/dev/null || true
git remote add origin "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${REPO_NAME}.git"
git push -u origin main --force
REPO_URL="https://github.com/${GITHUB_USER}/${REPO_NAME}"
echo "pushed -> ${REPO_URL}"

if [ -z "${RENDER_API_KEY:-}" ]; then
  echo ""
  echo "GitHub done. RENDER_API_KEY not set — finish on Render in 3 clicks:"
  echo "  New → Web Service → pick ${REPO_NAME} → it reads the Dockerfile → Create."
  echo "  Set env: STORE=memory SEED=1 HOST=0.0.0.0 BASIC_AUTH_USER=${BASIC_AUTH_USER} BASIC_AUTH_PASS=${BASIC_AUTH_PASS}"
  exit 0
fi

hdr_rn=(-H "Authorization: Bearer ${RENDER_API_KEY}" -H "Content-Type: application/json" -H "Accept: application/json")

echo "==> 3/4 resolve Render owner"
curl -s -o /tmp/rn_owners.json "${hdr_rn[@]}" "${RN_API}/owners?limit=1"
OWNER_ID=$(node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log((a[0].owner||a[0]).id)})" </tmp/rn_owners.json)
echo "ownerId=${OWNER_ID}"

echo "==> 4/4 create Render web service"
cat >/tmp/rn_body.json <<JSON
{
  "type": "web_service",
  "name": "${REPO_NAME}",
  "ownerId": "${OWNER_ID}",
  "repo": "${REPO_URL}",
  "branch": "main",
  "autoDeploy": "yes",
  "serviceDetails": {
    "runtime": "docker",
    "plan": "free",
    "region": "oregon",
    "healthCheckPath": "/health",
    "envSpecificDetails": { "dockerfilePath": "./Dockerfile", "dockerContext": "." }
  },
  "envVars": [
    { "key": "STORE", "value": "memory" },
    { "key": "SEED", "value": "1" },
    { "key": "HOST", "value": "0.0.0.0" },
    { "key": "BASIC_AUTH_USER", "value": "${BASIC_AUTH_USER}" },
    { "key": "BASIC_AUTH_PASS", "value": "${BASIC_AUTH_PASS}" }
  ]
}
JSON
http=$(curl -s -o /tmp/rn_service.json -w "%{http_code}" "${hdr_rn[@]}" -X POST "${RN_API}/services" -d @/tmp/rn_body.json)
echo "create service HTTP ${http}"
cat /tmp/rn_service.json
echo ""
URL=$(node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const s=JSON.parse(d);console.log((s.service||s).serviceDetails?.url||'')}catch(e){console.log('')}})" </tmp/rn_service.json)
echo ""
echo "================================================================"
echo " Service created. It will build the Docker image and go live."
echo " URL (once built): ${URL:-check Render dashboard}"
echo " Login: ${BASIC_AUTH_USER} / ${BASIC_AUTH_PASS}   ·   open <url>/admin"
echo "================================================================"
