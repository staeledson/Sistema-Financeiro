#!/usr/bin/env bash
# Teste de fumaça do deploy: confere, pela URL pública do FRONT, que a página, o proxy /api, a
# autenticação e o cadastro fechado respondem como esperado. Não usa segredos nem dados pessoais.
#
# Uso:
#   scripts/smoke-prod.sh https://meu-app.vercel.app
#
# Variáveis opcionais:
#   API_PREFIX         prefixo da API na URL dada (padrão "/api", que é o rewrite da Vercel).
#                      Para falar direto com a API (sem front), use API_PREFIX= (vazio).
#   SKIP_FRONT_CHECKS  "1" pula as checagens da página do front (/ e /painel). Use junto com
#                      API_PREFIX= ao testar a API direto, que não serve HTML.
#
# Atenção: a checagem de cadastro envia um email aleatório (@example.invalid) que NÃO está na lista de
# permissão. Se o cadastro estiver aberto (SIGNUP_ALLOWED_EMAILS="*"), esse usuário será criado e o teste
# acusa falha.
#
# Código de saída: 0 = tudo ok; 1 = alguma checagem falhou; 2 = alguma checagem ficou INCONCLUSIVA
# (ex.: limite de requisições ou origem errada no cadastro) e nenhuma falhou. Inconclusivo não é aprovação.

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Uso: $0 <URL_DO_FRONT>   (ex.: https://meu-app.vercel.app)" >&2
  exit 2
fi

case "$1" in
  http://* | https://*) ;;
  *)
    echo "A URL precisa começar com http:// ou https://" >&2
    exit 2
    ;;
esac

BASE="${1%/}"
API_PREFIX="${API_PREFIX-/api}"
SKIP_FRONT_CHECKS="${SKIP_FRONT_CHECKS-0}"
# O Better Auth recusa requisições sem um Origin confiável; o do navegador é a origem do front.
ORIGIN="$BASE"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

PASSED=0
FAILED=0
INCONCLUSIVE=0

pass() {
  PASSED=$((PASSED + 1))
  echo "  ✔ $1"
}

fail() {
  FAILED=$((FAILED + 1))
  echo "  ✘ $1"
}

inconclusive() {
  INCONCLUSIVE=$((INCONCLUSIVE + 1))
  echo "  ? $1"
}

# request <método> <caminho> [curl-args...]: grava corpo em $WORKDIR/body e define STATUS e CTYPE.
STATUS=""
CTYPE=""
request() {
  local method="$1" path="$2"
  shift 2
  local meta
  if ! meta="$(curl --silent --show-error --max-time 30 --request "$method" \
    --output "$WORKDIR/body" --write-out '%{http_code}|%{content_type}' "$@" "$BASE$path" 2>"$WORKDIR/err")"; then
    STATUS="000"
    CTYPE=""
    : >"$WORKDIR/body"
    return 0
  fi
  STATUS="${meta%%|*}"
  CTYPE="${meta#*|}"
}

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 8
  else
    printf '%x%x%x%x' "$RANDOM" "$RANDOM" "$RANDOM" "$RANDOM"
  fi
}

echo "Teste de fumaça em $BASE (prefixo da API: \"${API_PREFIX}\")"

# 1) O front serve o HTML.
if [ "$SKIP_FRONT_CHECKS" = "1" ]; then
  echo "  - pulado: front serve HTML em / (SKIP_FRONT_CHECKS=1)"
else
  request GET "/"
  case "$CTYPE" in
    text/html*) is_html=1 ;;
    *) is_html=0 ;;
  esac
  if [ "$STATUS" = "200" ] && [ "$is_html" = "1" ]; then
    pass "GET / -> 200 text/html"
  else
    fail "GET / -> esperado 200 text/html, veio $STATUS (${CTYPE:-sem content-type})"
  fi
fi

# 2) A API está de pé e enxerga o banco (passa pelo rewrite /api/:path* -> /:path*).
request GET "${API_PREFIX}/health"
if [ "$STATUS" = "200" ] && grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' "$WORKDIR/body"; then
  pass "GET ${API_PREFIX}/health -> 200 com ok:true"
else
  fail "GET ${API_PREFIX}/health -> esperado 200 com ok:true, veio $STATUS (502/504 = API fora do ar ou URL errada no vercel.json)"
fi

# 3) Rota protegida recusa quem não tem token.
request GET "${API_PREFIX}/balances"
if [ "$STATUS" = "401" ]; then
  pass "GET ${API_PREFIX}/balances sem token -> 401"
else
  fail "GET ${API_PREFIX}/balances sem token -> esperado 401, veio $STATUS"
fi

# 4) Cadastro fechado: um email fora da lista precisa ser recusado pelo hook do servidor (403 com a
#    mensagem "Cadastro não permitido"). Outro 4xx (429, origem errada...) não prova nada: inconclusivo.
signup_attempt() {
  SMOKE_EMAIL="smoke-$(rand_hex)@example.invalid"
  SMOKE_PASS="$(rand_hex)$(rand_hex)"
  local body="{\"email\":\"${SMOKE_EMAIL}\",\"password\":\"${SMOKE_PASS}\",\"name\":\"Smoke\"}"
  # O Better Auth fica sempre em /api/auth/* (o rewrite do front não remove esse prefixo).
  request POST "/api/auth/sign-up/email" \
    --header "Content-Type: application/json" --header "Origin: ${ORIGIN}" --data "$body"
}

SMOKE_EMAIL=""
SMOKE_PASS=""
signup_attempt
if [ "$STATUS" = "429" ]; then
  # Limite de requisições do Better Auth (janela curta): espera e tenta uma vez mais, com outro email.
  sleep 11
  signup_attempt
fi
if [ "$STATUS" = "403" ] && grep -q "Cadastro não permitido" "$WORKDIR/body"; then
  pass "POST /api/auth/sign-up/email com email fora da lista -> 403 \"Cadastro não permitido\""
else
  case "$STATUS" in
    2??)
      fail "POST /api/auth/sign-up/email com email fora da lista -> $STATUS: CADASTRO ABERTO! Defina SIGNUP_ALLOWED_EMAILS na API (e nunca use \"*\") e apague o usuário ${SMOKE_EMAIL} do banco"
      ;;
    429)
      inconclusive "POST /api/auth/sign-up/email -> 429 (limite de requisições): aguarde alguns segundos e rode de novo"
      ;;
    403)
      inconclusive "POST /api/auth/sign-up/email -> 403 sem a mensagem \"Cadastro não permitido\": provável recusa de origem; confira se BETTER_AUTH_URL é exatamente ${ORIGIN} (ou TRUSTED_ORIGINS)"
      ;;
    4??)
      inconclusive "POST /api/auth/sign-up/email -> $STATUS (não é a recusa da lista): confira a origem (BETTER_AUTH_URL = ${ORIGIN}), o rewrite /api/auth e o corpo da resposta"
      ;;
    *)
      fail "POST /api/auth/sign-up/email -> esperado 403, veio $STATUS"
      ;;
  esac
fi

# 5) Fallback de SPA: rotas do vue-router devolvem o index.html.
if [ "$SKIP_FRONT_CHECKS" = "1" ]; then
  echo "  - pulado: fallback SPA em /painel (SKIP_FRONT_CHECKS=1)"
else
  request GET "/painel"
  case "$CTYPE" in
    text/html*) is_html=1 ;;
    *) is_html=0 ;;
  esac
  if [ "$STATUS" = "200" ] && [ "$is_html" = "1" ]; then
    pass "GET /painel -> 200 text/html (fallback SPA)"
  else
    fail "GET /painel -> esperado 200 text/html, veio $STATUS (confira a regra de fallback no vercel.json)"
  fi
fi

echo
echo "Resumo: ${PASSED} ok, ${FAILED} com falha, ${INCONCLUSIVE} inconclusivas"
if [ "$FAILED" -ne 0 ]; then
  echo "✘ Teste de fumaça FALHOU"
  exit 1
fi
if [ "$INCONCLUSIVE" -ne 0 ]; then
  echo "? Teste de fumaça INCONCLUSIVO (veja as linhas com ?): não conta como aprovado"
  exit 2
fi
echo "✔ Teste de fumaça passou"
