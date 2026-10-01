# Imagem única para a API e o worker (a Railway define o comando de partida de cada serviço).
# O repositório roda direto do código-fonte (swc/tsx), então não há etapa de build do TypeScript
# e as devDependencies precisam existir em runtime. O front (Vue) vai para a Vercel.
FROM node:22-bookworm-slim

# openssl é exigido pelo motor do Prisma; ca-certificates para TLS (Postgres/Redis/S3 gerenciados).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# pnpm na mesma versão do campo "packageManager" do package.json, instalado num local legível por qualquer usuário.
ENV COREPACK_HOME=/usr/local/share/corepack
RUN corepack enable \
 && corepack prepare pnpm@11.9.0 --activate \
 && chmod -R a+rX /usr/local/share/corepack

# Roda sem root: o usuário "node" já existe na imagem base.
RUN mkdir /app && chown node:node /app
USER node
WORKDIR /app

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node packages ./packages
COPY --chown=node:node apps ./apps

# NODE_ENV=production só depois da instalação: antes, o pnpm omitiria as devDependencies.
# Instala só o necessário à API e ao worker (o front não entra na imagem); o store do pnpm e os caches
# são apagados na mesma camada para não pesarem na imagem (node_modules usa hardlinks, não depende deles).
RUN pnpm install --frozen-lockfile --filter . --filter @app/api... --filter @app/worker... \
 && pnpm exec prisma generate \
 && rm -rf ~/.local/share/pnpm ~/.cache

ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@app/api", "start:prod"]
