# Roteiro de deploy: Railway (back-end) + Vercel pessoal (front)

Este roteiro leva o sistema do seu computador para a internet, para uso pessoal. Quem executa os passos nos painéis é **você**: os segredos (chaves de API, senhas) são digitados por você direto nos painéis da Railway e da Vercel e nunca entram no repositório, que é **público**.

## Como as peças se encaixam

```
Navegador ──► Vercel (front Vue, apps/web)
                 │  rewrite: /api/*  ──►  Railway: serviço "api"  ──► Postgres, Redis, Bucket
                 │                         Railway: serviço "worker" ──► Postgres, Redis, Bucket
```

- O navegador só conversa com a origem da Vercel. A Vercel repassa `/api/...` para a API na Railway (o arquivo `apps/web/vercel.json` faz isso). Por isso não há problema de CORS.
- Na Railway ficam **dois serviços do mesmo repositório** (a API e o worker de filas), mais Postgres, Redis e um bucket de arquivos.
- A API e o worker usam a mesma imagem Docker (`Dockerfile` da raiz); cada serviço aponta para o seu arquivo `railway.json`.

Ordem do roteiro: (1) pré-requisitos, (2) Railway, (3) Vercel, (4) ligar os dois, (5) primeiro acesso, (6) segurança, (7) backup, (8) custos, rollback e problemas.

---

## 1. Pré-requisitos

1. Uma conta **pessoal** na Railway (https://railway.com) e uma conta **pessoal** na Vercel (https://vercel.com), as duas entrando com o seu GitHub pessoal.
2. O código final precisa estar na branch `main` do repositório público `github.com/staeledson/Sistema-Financeiro` (a Railway e a Vercel publicam a partir da `main`).
3. Chave do **OpenRouter** (https://openrouter.ai/keys) para a IA de ingestão e o chat, e chave do **Groq** (https://console.groq.com/keys) para transcrição de áudio. Sem elas o sistema sobe, mas a ingestão por IA, o chat e o áudio não funcionam.
4. O **email** que você vai usar para criar a sua conta (será o único autorizado a se cadastrar).
5. Opcional, para o passo de backup: o cliente do Postgres no seu Mac (`pg_dump`/`pg_restore`). No macOS: `brew install libpq` (depois siga a instrução que o Homebrew mostra para colocar `libpq` no PATH) ou `brew install postgresql@17`.
6. Para gerar o segredo de autenticação você precisa do `openssl` (já vem no macOS): `openssl rand -hex 32`.

> **Cuidado com o Chrome "Trabalho".** Se o seu Chrome está no perfil "Trabalho", é fácil abrir a Vercel já logado na conta da empresa. Use uma janela de outro perfil (ou aba anônima) com a conta **pessoal**, e confira o seletor de conta em cada painel, como descrito abaixo.

---

## 2. Railway

A sua conta Railway é um workspace pessoal ("Stael Edson's Projects", plano Hobby) que **já tem dois projetos sem relação com este**. Crie um projeto **novo** e **não mexa nos existentes**.

### 2.1 Criar o projeto

1. Entre em https://railway.com/dashboard. Confira no canto superior esquerdo/centro que o workspace é o pessoal ("Stael Edson's Projects").
2. Clique em **New Project** e escolha **Empty Project**. Dê o nome `sistema-financeiro` (clique no nome do projeto, em Settings, para renomear).

### 2.2 Adicionar Postgres e Redis

1. No canvas do projeto, clique em **+ Create** (ou **New**) e escolha **Database** e depois **Add PostgreSQL**. O serviço aparece com o nome `Postgres`.
2. Repita: **+ Create**, **Database**, **Add Redis**. O serviço aparece com o nome `Redis`.
3. Os nomes `Postgres` e `Redis` importam: as referências de variáveis abaixo (`${{Postgres.DATABASE_URL}}`) usam o **nome do serviço**. Se o seu estiver diferente, ajuste a referência.

### 2.3 Conferir a política do Redis (`noeviction`)

O BullMQ (filas) exige que o Redis **nunca descarte chaves** por falta de memória (`maxmemory-policy = noeviction`). Para conferir:

1. Abra o serviço `Redis`, aba **Variables**, e copie o valor de `REDIS_PUBLIC_URL` (a URL de acesso de fora da Railway; ela é um segredo, não cole em lugar nenhum).
2. No terminal do seu Mac (precisa do `redis-cli`: `brew install redis`):

```
redis-cli -u '<REDIS_PUBLIC_URL>' CONFIG GET maxmemory-policy
```

3. O esperado é a resposta `noeviction` (é o padrão do Redis quando não há limite de memória). Se vier outro valor, ajuste:

```
redis-cli -u '<REDIS_PUBLIC_URL>' CONFIG SET maxmemory-policy noeviction
```

Esse ajuste vale até o Redis reiniciar: confira de novo de vez em quando (ou depois de qualquer reinício do serviço Redis).

### 2.4 Adicionar o bucket (arquivos)

Comprovantes, imagens e PDFs enviados para a IA ficam num bucket compatível com S3.

1. **+ Create**, **Bucket**. Anote o nome do serviço do bucket (ex.: `Bucket`).
2. Abra o bucket e olhe a aba de credenciais/variáveis (**Credentials** ou **Variables**). Você vai precisar de: endpoint, chave de acesso, chave secreta e o **nome real do bucket** (na Railway o nome costuma ser gerado, e não é `financas`). Os nomes exatos das variáveis (por exemplo `ENDPOINT`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `BUCKET`) podem variar: use os que o painel mostrar.
3. O sistema usa endereçamento por caminho (`forcePathStyle`) e região `us-east-1` fixa, o que funciona com S3 genérico. Se algum dia o upload falhar com erro de assinatura/região, veja "Solução de problemas".

Alternativa se o bucket da Railway não servir: Cloudflare R2 (S3-compatível); basta preencher as variáveis `MINIO_*` com os dados dele.

### 2.5 Criar o serviço "api"

1. **+ Create**, **GitHub Repo**. Na primeira vez, a Railway pede para instalar o app do GitHub: dê acesso **somente** ao repositório `staeledson/Sistema-Financeiro`. Escolha o repositório.
2. Renomeie o serviço para `api` (aba **Settings**, campo do nome).
3. Em **Settings**:
   - **Source**, **Branch**: `main`. **Root Directory**: deixe **vazio** (a raiz do repositório; o Dockerfile precisa enxergar o monorepo inteiro).
   - **Config-as-code** (campo "Railway Config File"): `/apps/api/railway.json`.
   - **Networking**, **Generate Domain**: gera um endereço público como `api-production-xxxx.up.railway.app`. Anote-o (você usa no passo 4). Se pedir uma porta, use a que aparece nos logs ("API ouvindo em ...:PORTA"); a Railway define `PORT` sozinha.
4. **Antes do primeiro deploy bem-sucedido**, cadastre as variáveis (tabela abaixo) na aba **Variables**. O primeiro deploy pode começar sozinho e falhar por falta de variável: tudo bem, depois de cadastrar clique em **Deploy** para aplicar as mudanças.

#### Variáveis do serviço `api`

Cadastre os **nomes** abaixo na aba Variables. Os valores entre `<...>` são marcadores: você preenche. Nunca coloque valores reais neste arquivo nem no repositório.

| Variável | Valor | Obrigatória | Para quê |
|---|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | sim | Banco (URL privada, rede interna da Railway). |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | sim | Filas (URL privada). |
| `BETTER_AUTH_SECRET` | `<gerar com: openssl rand -hex 32>` | sim | Assina as sessões. Trocar desloga todo mundo. |
| `BETTER_AUTH_URL` | `<origem do front, ex.: https://seu-app.vercel.app>` | sim | Origem que o navegador vê (a da Vercel, **não** a da API), sem barra no final. |
| `SIGNUP_ALLOWED_EMAILS` | `<seu-email@exemplo.com>` | sim | Lista (separada por vírgula) de quem pode criar conta. **Sem isso o cadastro fica aberto na internet.** |
| `TRUST_PROXY` | `true` | sim | Confia nos cabeçalhos do proxy da Railway/Vercel. |
| `TRUSTED_ORIGINS` | `<https://outro-dominio.exemplo>` | não | Origens extras confiáveis (ex.: domínio próprio no futuro), separadas por vírgula. |
| `APP_URL` | `<origem do front>` | recomendada | Base dos links de convite enviados por email. |
| `OPENROUTER_API_KEY` | `<chave do OpenRouter>` | para o chat | Chat "Pergunte às suas finanças". |
| `OPENROUTER_DATA_COLLECTION` | `deny` | recomendada | `deny` (padrão) não permite que provedores retenham seus dados; ver "Solução de problemas". |
| `OPENROUTER_MODEL` | `<modelo, ex.: openai/gpt-4o-mini>` | não | Modelo do chat (há um padrão). |
| `MINIO_ENDPOINT` | `${{Bucket.ENDPOINT}}` (ou o endpoint do painel) | para anexos | Endpoint S3 do bucket. |
| `MINIO_ACCESS_KEY` | `${{Bucket.ACCESS_KEY_ID}}` (ou do painel) | para anexos | Chave de acesso do bucket. |
| `MINIO_SECRET_KEY` | `${{Bucket.SECRET_ACCESS_KEY}}` (ou do painel) | para anexos | Chave secreta do bucket. |
| `MINIO_BUCKET` | `${{Bucket.BUCKET}}` (ou o nome real do bucket) | para anexos | Nome do bucket. |
| `VAPID_PUBLIC_KEY` | `<gerar com: npx web-push generate-vapid-keys>` | não | Notificações push (a API entrega a chave pública ao navegador). |
| `MAIL_API_KEY` | `<chave do Resend>` | não | Envio de email de convites. Sem ela, o email só aparece nos logs. |

Não defina `PORT` nem `NODE_ENV` (a Railway e o Dockerfile cuidam disso). As referências `${{Serviço.VARIAVEL}}` são resolvidas pela Railway: a `DATABASE_URL` e a `REDIS_URL` usam a rede **privada** (de graça e sem exposição). Se o bucket usar nomes de variável diferentes dos do exemplo, copie os valores direto do painel dele.

#### O que esperar no primeiro deploy da API

1. A Railway **constrói** a imagem a partir do `Dockerfile` (alguns minutos).
2. Antes de subir a API, roda o **preDeploy**: `pnpm exec prisma migrate deploy`, que cria as tabelas no banco vazio. Nos logs aparecem as migrations sendo aplicadas.
3. Depois a API sobe e a Railway chama `GET /health` (até 120 s). Quando responde `200`, o deploy fica verde ("Active").
4. Teste no navegador: `https://<dominio-da-api>/health` deve mostrar `{"ok":true,"db":true}`.

**O primeiro build é o verdadeiro teste em x64.** A imagem foi testada localmente só em arm64 (Mac); a Railway constrói em x64. Se o build falhar, olhe os **Build Logs**:
- Uma mensagem de erro do `node-gyp` / `msgpackr-extract` durante o `pnpm install` é **inofensiva** (é um acelerador opcional); se o build continua depois dela, ignore.
- Falhas de verdade costumam aparecer em `pnpm install --frozen-lockfile` (lockfile fora de sincronia), em `prisma generate` (motor/openssl) ou como `Killed`/código 137 (falta de memória no build). Copie as últimas ~30 linhas do log para pedir ajuda.

### 2.6 Criar o serviço "worker"

1. **+ Create**, **GitHub Repo**, o mesmo repositório. Renomeie para `worker`.
2. **Settings**: Branch `main`, Root Directory **vazio**, Config-as-code `/apps/worker/railway.json`. **Não gere domínio público** (o worker não recebe requisições).
3. Variáveis do `worker` (mesmo critério: nomes aqui, valores no painel):

| Variável | Valor | Obrigatória | Para quê |
|---|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | sim | Banco. |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | sim | Filas (o worker consome daqui). |
| `OPENROUTER_API_KEY` | `<chave do OpenRouter>` | para IA | Ingestão por texto/imagem/PDF. |
| `OPENROUTER_DATA_COLLECTION` | `deny` | recomendada | Mesmo significado da API. |
| `OPENROUTER_VISION_MODEL` | `<modelo, ex.: google/gemini-2.0-flash-001>` | não | Modelo que lê imagens (há um padrão). |
| `OPENROUTER_TEXT_MODEL` | `<modelo, ex.: openai/gpt-4o-mini>` | não | Modelo de texto (há um padrão). |
| `GROQ_API_KEY` | `<chave do Groq>` | para áudio | Transcrição de áudio (só o worker usa). |
| `MINIO_ENDPOINT` | igual ao da API | para anexos | Bucket. |
| `MINIO_ACCESS_KEY` | igual ao da API | para anexos | Bucket. |
| `MINIO_SECRET_KEY` | igual ao da API | para anexos | Bucket. |
| `MINIO_BUCKET` | igual ao da API | para anexos | Bucket. |
| `VAPID_PUBLIC_KEY` | `<a mesma chave pública da API>` | não | Push (precisa do par completo). |
| `VAPID_PRIVATE_KEY` | `<gerar com: npx web-push generate-vapid-keys>` | não | Push (o worker envia as notificações). |

4. Clique em **Deploy**. O worker não tem healthcheck HTTP: nos **Deploy Logs** deve aparecer `Worker started`. Se ficar reiniciando, veja "Solução de problemas" (worker sem Redis).

---

## 3. Vercel (conta pessoal)

1. Use um navegador/perfil com a sua conta **pessoal** e abra https://vercel.com/dashboard.
2. **Antes de importar qualquer coisa, olhe o seletor de conta/time no canto superior esquerdo.** Ele deve mostrar a sua conta **pessoal** (seu nome/usuário, plano Hobby). **Nunca** use o time da empresa ("pluralmed's projects"). Se estiver nele, clique no seletor e troque para a conta pessoal; se a conta pessoal não aparece, você está logado com o usuário errado: saia e entre com a pessoal.
3. **Add New...**, **Project**. Conecte o GitHub pessoal se pedir e escolha o repositório `Sistema-Financeiro`, **Import**.
4. Na tela de configuração:
   - **Framework Preset**: Vite (a Vercel detecta).
   - **Root Directory**: clique em **Edit** e escolha `apps/web`.
   - **Build/Install Command**: deixe o padrão (o `apps/web/vercel.json` já define os comandos).
   - **Environment Variables**: nenhuma é obrigatória.
5. Clique em **Deploy**. O primeiro deploy sobe o front, mas o `/api` ainda aponta para um endereço de exemplo (`API_PUBLICA`): isso é esperado, e o passo 4 corrige.
6. Se o build falhar por não achar os pacotes do monorepo, abra **Settings**, **General** e confirme que **Include source files outside of the Root Directory in the Build Step** está ligado.
7. Anote o endereço do projeto (`https://<nome>.vercel.app`, em **Domains**): é a **origem do front**.

---

## 4. Ligar a Vercel à Railway

1. No seu computador, na branch `main`, abra `apps/web/vercel.json` e troque **as duas ocorrências** de `API_PUBLICA` pelo endereço público da API **sem** `https://` e sem barra (ex.: `api-production-xxxx.up.railway.app`). Ficam assim:
   - `/api/auth/:path*` -> `https://<dominio-da-api>/api/auth/:path*`
   - `/api/:path*` -> `https://<dominio-da-api>/:path*`
2. Faça o commit e o push para `main`. A Vercel faz um novo deploy sozinha.
3. Na Railway, serviço `api`, **Variables**: ajuste `BETTER_AUTH_URL` (e `APP_URL`) para a origem do front, por exemplo `https://<nome>.vercel.app`, sem barra no final. Clique em **Deploy** para a API reiniciar com o valor novo.
4. Rode o teste de fumaça no seu terminal, na raiz do repositório:

```
scripts/smoke-prod.sh https://<nome>.vercel.app
```

Ele confere cinco coisas e termina com um resumo `✔`/`✘`: a página abre, `/api/health` responde `ok`, uma rota protegida devolve 401 sem token, um email fora da lista é recusado no cadastro e uma rota do app (`/painel`) cai no `index.html`. Se algum item falhar, o texto da linha diz o que olhar; veja também "Solução de problemas". Observação: o teste faz **uma tentativa de cadastro** com um email descartável (`@example.invalid`); com a lista de permissão ativa ela é recusada e nada é criado.

Importante sobre o `Origin`: as rotas do Better Auth (`/api/auth/...`) recusam requisições sem uma origem confiável. No navegador, a origem é a do front, e por isso o `BETTER_AUTH_URL` precisa ser **exatamente** essa origem (mesmo `https`, mesmo domínio, sem barra). O script manda `Origin: <a URL do front que você passou>` pelo mesmo motivo.

---

## 5. Primeiro acesso

1. Abra `https://<nome>.vercel.app` e **crie sua conta** com o email que você colocou em `SIGNUP_ALLOWED_EMAILS`.
2. Confira que o cadastro é fechado: em uma aba anônima, tente criar outra conta com um email diferente. Deve ser recusado.
3. Importe um extrato (OFX/CSV/PDF) para testar a importação (isso exercita API, worker, Redis e bucket).
4. Teste a IA: lance uma despesa por texto e faça uma pergunta no chat. Se der erro, veja "Solução de problemas" (OpenRouter).
5. Instale o PWA: no Chrome/Edge, ícone de instalação na barra de endereço; no iPhone, Compartilhar, **Adicionar à Tela de Início**.
6. Faça o primeiro **backup** (seção 7) e teste a restauração em um banco descartável.

---

## 6. Segurança

- **Segredos só nos painéis.** `BETTER_AUTH_SECRET`, chaves do OpenRouter/Groq, do bucket, do VAPID e do Resend ficam nas Variables da Railway. Nada disso vai para o repositório (que é público) nem para este arquivo. Não cole URLs do banco (`DATABASE_PUBLIC_URL`) em chats, issues ou prints.
- **`SIGNUP_ALLOWED_EMAILS` é obrigatória** em produção: sem ela, qualquer pessoa que ache o endereço cria conta.
- **Rotação.** Se uma chave vazar, gere outra no provedor, troque a variável na Railway e faça **Deploy**. Trocar `BETTER_AUTH_SECRET` desloga todas as sessões (é esperado). Para convidar mais gente, acrescente o email à lista (separada por vírgula) e faça **Deploy**.
- **O repositório é público.** Nunca faça commit de `.env`, dumps do banco (`*.dump`) ou prints com dados reais. O `.gitignore` já ignora `.env`, `*.dump` e `backups/`.
- A API também fica acessível direto pelo domínio da Railway; as rotas protegidas continuam exigindo login, mas o caminho normal é sempre pela Vercel.

---

## 7. Backup e restauração

**O Postgres da Railway é a única cópia dos seus dados financeiros.** Faça backup antes de depender do sistema e mantenha uma rotina.

### 7.1 Quando fazer

- Uma vez por mês (de preferência agendado, seção 7.3).
- Antes de qualquer deploy que traga uma **migration grande** (renomear/remover colunas ou tabelas).
- Depois de importar muita coisa que você não quer perder.

Complemento: o app também tem exportação (CSV, XLSX e backup em JSON) na própria interface. Ela é útil para você ler os dados, mas **não substitui** o `pg_dump`, que copia o banco inteiro.

### 7.2 Gerar um backup manual

1. Na Railway, serviço `Postgres`, aba **Variables**, copie `DATABASE_PUBLIC_URL` (o endereço de fora da Railway, via proxy TCP). **Não** use a `DATABASE_URL` privada: ela só funciona dentro da Railway. Trate a URL como senha.
2. Crie a pasta de backups **fora** do repositório (ou use `backups/` dentro dele, que o `.gitignore` ignora, mas o ideal é fora):

```
mkdir -p ~/Backups/financas
```

3. Gere o dump (formato customizado, comprimido). Troque `<DATABASE_PUBLIC_URL>` pela URL, mantendo as aspas simples:

```
pg_dump --format=custom --no-owner --no-privileges --file "$HOME/Backups/financas/financas-$(date +%Y-%m-%d).dump" '<DATABASE_PUBLIC_URL>'
```

4. Confira que o arquivo foi criado e lista as tabelas:

```
pg_restore --list "$HOME/Backups/financas/financas-$(date +%Y-%m-%d).dump"
```

A versão do `pg_dump` precisa ser **igual ou maior** que a do Postgres da Railway. Se aparecer `server version mismatch`, instale um cliente mais novo (`brew install postgresql@17`, por exemplo).

Alternativa com o CLI da Railway: `railway connect Postgres` abre um `psql` na conta logada, mas o CLI precisa estar autenticado na conta **pessoal** e no projeto certo; o dump pela URL pública acima é mais simples e previsível.

> **Dumps contêm dados financeiros.** Eles **nunca** vão para o repositório (já estão no `.gitignore` como `*.dump` e `backups/`), nem para pastas públicas, links compartilhados ou email. Guarde em disco criptografado (FileVault ligado) e, se copiar para a nuvem, só em armazenamento privado da sua conta.

### 7.3 Agendar (mensal)

Guarde a URL num arquivo que só você lê, **fora do repositório**:

```
mkdir -p ~/.config/financas
```

Crie o arquivo `~/.config/financas/pg_url` com a URL pública (uma linha) e restrinja a permissão:

```
chmod 600 ~/.config/financas/pg_url
```

Crie o script `~/bin/backup-financas.sh` (também fora do repositório):

```
#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$HOME/Backups/financas"
pg_dump --format=custom --no-owner --no-privileges \
  --file "$HOME/Backups/financas/financas-$(date +%Y-%m-%d).dump" \
  "$(cat "$HOME/.config/financas/pg_url")"
# apaga dumps com mais de 180 dias
find "$HOME/Backups/financas" -name 'financas-*.dump' -mtime +180 -delete
```

Torne-o executável (`chmod +x ~/bin/backup-financas.sh`) e agende com o `cron` (`crontab -e`), por exemplo no dia 1 de cada mês às 9h:

```
0 9 1 * * PATH=/opt/homebrew/bin:/opt/homebrew/opt/libpq/bin:/usr/local/bin:/usr/bin:/bin $HOME/bin/backup-financas.sh
```

Ajuste o `PATH` para onde o seu `pg_dump` está (`which pg_dump`). No macOS o `cron` pode precisar de permissão de "Acesso total ao disco"; se preferir, use um agendamento do `launchd`. O Mac precisa estar ligado na hora; se não estiver, rode o script à mão (ou rode o comando da seção 7.2).

### 7.4 Backups automáticos da Railway

Na Railway, abra o serviço `Postgres`, o volume e procure uma aba **Backups**. Alguns planos oferecem backup automático de volume; confira se o seu oferece. Se oferecer, ative como camada extra, mas **mantenha o `pg_dump` local**: o backup da própria plataforma não protege você de apagar o projeto por engano ou de perder a conta.

### 7.5 Restaurar

Teste a restauração **antes** de precisar dela, em um banco descartável no seu Mac (não use o Postgres de desenvolvimento do `docker-compose`, que seria sobrescrito):

```
docker run --rm -d --name teste-restore -e POSTGRES_PASSWORD=teste -p 5440:5432 postgres:16-alpine
pg_restore --no-owner --no-privileges --dbname 'postgresql://postgres:teste@localhost:5440/postgres' "$HOME/Backups/financas/financas-AAAA-MM-DD.dump"
docker exec teste-restore psql -U postgres -c "select count(*) from transactions"
docker rm -f teste-restore
```

Restauração de verdade, no Postgres da Railway:

1. **Pause a escrita**: na Railway, nos serviços `api` e `worker`, abra o menu do último deploy e escolha **Remove** (ou pare o serviço), para ninguém gravar durante a restauração.
2. Restaure por cima do banco (apaga e recria os objetos do dump):

```
pg_restore --clean --if-exists --no-owner --no-privileges --dbname '<DATABASE_PUBLIC_URL>' "$HOME/Backups/financas/financas-AAAA-MM-DD.dump"
```

3. Faça um novo deploy dos serviços `api` e `worker` (aba **Deployments**, **Redeploy**). O `preDeploy` roda `migrate deploy`, que aplica as migrations que o dump ainda não tenha.
4. Rode `scripts/smoke-prod.sh https://<nome>.vercel.app` e entre no app para conferir os dados.

Se a restauração for em um banco **novo e vazio** (por exemplo, depois de recriar o serviço Postgres), troque a `DATABASE_URL`/`REDIS_URL` referenciadas se os nomes dos serviços mudarem e use o mesmo comando sem `--clean --if-exists`.

---

## 8. Custos, rollback e solução de problemas

### 8.1 Custos esperados

Os preços mudam: **confira sempre** em https://railway.com/pricing e https://vercel.com/pricing antes de decidir. De modo geral:

- **Railway, plano Hobby:** assinatura mensal que **inclui um crédito mensal de uso** do mesmo valor. O consumo (CPU, memória, disco e tráfego de saída) é cobrado por uso e abatido do crédito; o que passar disso é cobrado à parte. Aqui rodam quatro serviços (api, worker, Postgres, Redis) mais o bucket; para uso pessoal o gasto costuma ser baixo, mas o valor real aparece em **Usage** no painel da Railway. O crédito é do **workspace inteiro**, então o consumo dos seus dois projetos antigos soma com o deste.
- Em **Settings**, **Usage** (ou **Billing**) da Railway, veja se há opção de **limite de uso** (hard limit) e defina um valor com o qual você se sinta confortável.
- **Vercel, plano Hobby:** gratuito para uso pessoal e não comercial, com limites de uso.
- **OpenRouter e Groq:** cobrados por uso (você coloca crédito). Defina limites de gasto no painel deles.

### 8.2 Pausar ou remover

- **Pausar a conta de gastos:** na Railway, em cada serviço, no menu do deploy ativo, **Remove** para o serviço parar de consumir (os dados do Postgres continuam no volume). Para parar tudo, remova `api` e `worker`; Postgres e Redis ainda consomem um pouco.
- **Apagar de vez:** **faça um backup antes** (seção 7). Depois, em **Settings** do projeto na Railway, **Delete Project**. Na Vercel, **Settings**, **General**, **Delete Project**.

### 8.3 Rollback

- **API ou worker (Railway):** serviço, aba **Deployments**, escolha um deploy anterior que estava saudável, menu `...`, **Redeploy** (ou **Rollback**, se disponível). Alternativa: `git revert <commit>` e push para `main`.
- **Front (Vercel):** projeto, **Deployments**, escolha o deploy anterior, menu `...`, **Promote to Production** (ou **Instant Rollback**).
- **Atenção às migrations:** voltar o código **não desfaz** migrations já aplicadas no banco. Se a migration problemática removeu ou alterou dados, a saída é restaurar um backup (seção 7.5). Por isso o backup antes de migrations grandes.

### 8.4 Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Chat ou ingestão por IA responde erro 404 "No endpoints found matching your data policy" | Com `OPENROUTER_DATA_COLLECTION=deny`, o modelo escolhido só é servido por provedores que coletam dados | Troque o modelo (`OPENROUTER_MODEL`, `OPENROUTER_VISION_MODEL`, `OPENROUTER_TEXT_MODEL`) por um que tenha provedor sem coleta. Só use `allow` se aceitar que o provedor retenha dados financeiros. |
| Falha ao enviar imagem/áudio/PDF; erro do bucket nos logs da API/worker | Variáveis `MINIO_*` erradas, bucket com outro nome, ou região/assinatura recusada | Confira `MINIO_BUCKET` (nome real, não `financas`), endpoint e chaves. Se o navegador mostrar erro de CORS ao enviar a imagem (o upload do envio compartilhado vai direto do navegador ao bucket), libere `PUT` da origem do front nas configurações de CORS do bucket, se o seu bucket permitir; se não permitir, use Cloudflare R2. |
| `/api/...` devolve 502 ou 504 na Vercel | API fora do ar, ou `API_PUBLICA` não foi trocado / está com o endereço errado no `vercel.json` | Abra `https://<dominio-da-api>/health` direto. Se não responder, veja os logs da API na Railway. Se responder, corrija o `vercel.json` (sem `https://` duplicado, sem barra no final), commit e push. |
| Login ou cadastro dá erro de origem ("Invalid origin" / 403) | `BETTER_AUTH_URL` diferente da origem do front, ou a origem não está confiável | Faça `BETTER_AUTH_URL` ser exatamente `https://<nome>.vercel.app` (sem barra), clique em **Deploy** na API. Para outro domínio, acrescente em `TRUSTED_ORIGINS`. |
| Cadastro do seu próprio email é recusado | Email fora de `SIGNUP_ALLOWED_EMAILS` ou com erro de digitação | Corrija a variável (sem diferenciar maiúsculas; vírgula entre emails) e faça **Deploy**. |
| Deploy da API falha no `preDeploy` | `DATABASE_URL` ausente/errada, ou banco inalcançável | Confira a referência `${{Postgres.DATABASE_URL}}` e o nome do serviço do Postgres; veja o log do preDeploy. |
| API reinicia, healthcheck falha | `/health` devolve 503 (banco) ou a API não sobe | Veja os **Deploy Logs**; confira `DATABASE_URL`, `BETTER_AUTH_SECRET` e `REDIS_URL`. |
| Worker reinicia em loop ou os jobs ficam parados ("pendentes") | `REDIS_URL` ausente/errada, Redis fora do ar, ou política diferente de `noeviction` | Confira `${{Redis.REDIS_URL}}` no worker **e** na API, e a política (seção 2.3). Nos logs deve aparecer `Worker started`. |
| Build na Railway falha | Imagem testada só em arm64 | Veja a seção 2.5 ("O primeiro build é o verdadeiro teste em x64"). O erro de `node-gyp`/`msgpackr-extract` isolado é inofensivo. |
| Build na Vercel falha ao instalar pacotes | Arquivos fora do Root Directory desligados | Settings, General, ligue "Include source files outside of the Root Directory". |
| Páginas do app dão 404 ao recarregar | Regra de fallback ausente | Confira que o `vercel.json` do deploy tem a regra `/((?!api/).*)` -> `/index.html`; o smoke test acusa isso em `/painel`. |
| Upload grande falha na Vercel | Limite de tamanho de corpo do proxy | Extratos ficam bem abaixo do limite. Se algum dia falhar, o plano B é o front chamar a API direto (`VITE_API_URL`) com CORS habilitado na API (não implementado). |

Sempre que mudar uma variável na Railway, lembre de clicar em **Deploy** para ela valer.
