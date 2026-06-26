# Plano de Desenvolvimento — Plataforma de Finanças Pessoais com IA

> Documento de roadmap (upstream). Cada fase aqui vira, na execução, um plano detalhado via `superpowers:writing-plans` + `subagent-driven-development`. Veja a seção 11.

**Codinome:** a definir (sugestões: *Centavo*, *Fluxo*, *Saldo*, *Grano*)
**Data:** 2026-06-25
**Autor:** Stael

---

## 1. Visão geral

Plataforma SaaS multiusuário de gestão de finanças pessoais com **entrada de dados de baixo atrito por IA** (foto de comprovante/Pix, voz e texto livre), além de import de arquivos e lançamento manual rápido. Suporta **workspaces** de três tipos — pessoal, familiar (compartilhado) e PJ — com papéis e isolamento de dados por workspace.

**Proposta de valor / diferencial:** o motivo nº 1 de abandono de apps de finanças é o atrito do lançamento manual. O produto ataca isso de frente: você fotografa o comprovante, fala ou digita em linguagem natural e a IA estrutura a transação pra você revisar. A camada de inteligência (categorização que aprende, detecção de anomalias, previsão de saldo, chat "pergunte às suas finanças") transforma registro em decisão.

**Não-objetivos (v1):** corretora/execução de investimentos, contabilidade fiscal completa de PJ (emissão de NF, apuração de impostos), conselho financeiro regulado.

---

## 2. Pesquisa de mercado (resumo executivo)

O mercado brasileiro tem três gerações coexistindo:

| Geração | Exemplos | Característica | Limitação |
|---|---|---|---|
| Tradicional (manual) | Mobills, Organizze, Minhas Economias | Lançamento manual, gráficos, orçamentos, metas, multiplataforma | Alto atrito → abandono |
| Open Finance | Guiabolso (histórico), iDinheiro | Sincronização bancária automática + categorização | Regulado, complexo, custo de agregador |
| **IA-first (tendência 2026)** | Jota, FinFlux, Financinha | Lançamento conversacional (texto/áudio/imagem), categorização automática, alertas, separação PF/PJ | Nicho novo, lock-in em WhatsApp |

**Table-stakes (o que o produto precisa ter pra ser levado a sério):** receitas/despesas, múltiplas contas/carteiras, categorias e tags, orçamentos por categoria (incl. método 50/30/20), metas/cofrinhos, transações recorrentes e lembretes de contas, cartão de crédito/fatura, e relatórios visuais (receita×despesa, por categoria, evolução temporal). Categorização automática por IA já é **expectativa**, não diferencial.

**Referências open-source (modelagem de domínio):** o **Firefly III** (PHP/Laravel, partida dobrada, API REST completa, rules engine, Docker) é a melhor referência de modelagem rigorosa; o **Actual Budget** (orçamento por envelopes/soma-zero, UI polida, responsivo) é referência de UX. Padrão recorrente nos dois: Postgres + API REST + motor de regras.

**Gap/oportunidade:** unir o rigor de modelagem do Firefly, a UX do Actual e a ingestão por IA dos novos players — sem amarrar tudo ao WhatsApp, entregando um PWA mobile-first próprio com colaboração familiar e PJ.

---

## 3. Decisões de produto e escopo

**Confirmadas:**

- **Escopo:** SaaS multiusuário. Conceito central de **workspace** com três tipos: `personal`, `family` (compartilhado entre usuários), `business` (PJ). RBAC por workspace.
- **Entrada de dados no MVP:** (1) IA — foto/voz/texto; (2) Import — CSV/OFX/fatura PDF; (3) Manual rápido.
- **IA via OpenRouter** como gateway único de LLM.

**Adiado para fase posterior:** Open Finance / sincronização bancária (fase 7), por ser o caminho regulado e dependente de agregador pago.

**Plataforma:** PWA mobile-first + responsivo desktop (Brasil é Pix/mobile; reaproveita sua experiência de PWA).

---

## 4. Arquitetura técnica

### 4.1 Stack recomendada (e o porquê)

A espinha dorsal do produto é um **pipeline assíncrono de jobs de IA** (foto→fila→worker→OpenRouter→transação) — exatamente o padrão BullMQ/Redis que você já domina. Some a isso multi-tenancy com compartilhamento familiar/PJ, storage de comprovantes e a necessidade de isolamento forte de dados. Daí a recomendação:

| Camada | Escolha | Justificativa |
|---|---|---|
| Frontend | **Vue 3 + Vite + Pinia + Vue Router**, PWA (`vite-plugin-pwa`), i18n pt-BR | Seu forte; PWA reaproveita o Luna |
| UI/Charts | PrimeVue **ou** Reka UI (shadcn-vue) + **ECharts** (ou Chart.js) | ECharts é forte pra dashboards financeiros |
| Backend (API) | **Node + TypeScript** (NestJS com adapter Fastify) | NestJS dá módulos por domínio, DI e **guards pra RBAC** — bom pra SaaS que cresce; TS unifica linguagem com o Vue |
| Workers/IA | **Node + BullMQ + Redis** | Reaproveita seu padrão de pipeline (canal/Luna) |
| Banco + Auth + Storage | **Supabase** (Postgres + Auth + **RLS** + Storage) | Você já usa; RLS dá isolamento multi-tenant em nível de banco (defesa em profundidade); Storage resolve comprovantes |
| ORM | Prisma (ou Drizzle) sobre o Postgres do Supabase | DX, migrations tipadas |
| Gateway de IA | **OpenRouter** | Troca de modelo por env, multimodal, structured output |
| STT (voz) | Whisper via **Groq** (ou OpenAI) | Você já usou Groq Whisper; barato/rápido. O texto resultante entra no parser LLM |
| Deploy | API/workers em **Railway** (Docker), front em **Vercel**, Redis no Railway | Stack que você já opera |

**Alternativa sem BaaS** (se quiser zero vendor lock-in): NestJS + Prisma + Postgres próprio + auth próprio (Lucia/Auth.js) + storage S3-compatível. Trade-off: você reimplementa auth, RLS e storage que o Supabase entrega prontos.

> Decisão de fundação a tomar cedo (ver seção 10): **ledger simples vs partida dobrada**. Recomendo começar com um modelo de transação que já trate transferências com `account_origem`/`account_destino` (quase-double-entry) e deixar a partida dobrada plena como evolução para o rigor contábil do PJ.

### 4.2 Fluxo lógico (ingestão por IA)

```
[Foto/Áudio/Texto no PWA]
        │  upload (Storage) / texto
        ▼
[API: cria AIJob + enfileira]──► [Redis/BullMQ]
                                      │
                                      ▼
                            [Worker de ingestão]
                              ├─ imagem → OpenRouter (modelo de visão) → JSON
                              ├─ áudio  → Whisper (Groq) → texto → OpenRouter (parser) → JSON
                              └─ texto  → OpenRouter (parser) → JSON
                                      │  valida (Zod) + categoriza
                                      ▼
                          [Transação "pendente de revisão"]
                                      │  push/realtime
                                      ▼
                        [Tela de revisão no PWA → confirma]
```

---

## 5. Modelo de domínio (entidades principais)

| Entidade | Campos-chave | Observações |
|---|---|---|
| `User` | id, email, nome | Auth no Supabase |
| `Workspace` | id, tipo (`personal`/`family`/`business`), nome, moeda padrão | Unidade de isolamento (RLS por `workspace_id`) |
| `WorkspaceMember` | user_id, workspace_id, role (`owner`/`admin`/`member`/`viewer`) | RBAC |
| `Account` | workspace_id, tipo (`checking`/`savings`/`credit_card`/`cash`/`investment`), saldo inicial, moeda | Carteira/conta |
| `Category` | workspace_id?, tipo (`income`/`expense`), parent_id, ícone, cor | Defaults globais + custom por workspace; hierárquica |
| `Tag` | workspace_id, nome | Marcação livre |
| `Transaction` | workspace_id, account_id, tipo (`income`/`expense`/`transfer`), valor, data, category_id, descrição, counterparty, origem (`manual`/`ai`/`import`/`openfinance`), ai_confidence, status (`confirmed`/`pending_review`) | Núcleo |
| `TransactionAttachment` | transaction_id, tipo (`image`/`audio`/`pdf`), storage_path | Comprovantes |
| `RecurringRule` / `ScheduledBill` | workspace_id, template de transação, frequência, próxima data | Recorrências e contas a pagar |
| `Budget` | workspace_id, escopo (categoria/global), período, limite, método (`fixed`/`50-30-20`) | Orçamentos |
| `Goal` | workspace_id, nome, alvo, prazo, saldo acumulado | Metas/cofrinhos |
| `AIJob` | tipo, status, payload, result, custo_tokens | Auditoria e custo de IA |
| `Insight` | workspace_id, tipo (`anomaly`/`subscription`/`forecast`/`summary`), payload, período | Inteligência |
| `ImportBatch` | workspace_id, formato, mapping, status, dedup_report | Imports |
| `AuditLog` | actor, workspace_id, ação, antes/depois | Compliance |

---

## 6. Roadmap por fases

Cada fase entrega software funcional e testável por si só. "Pronto" = critério de aceite atendido + testes verdes.

### Fase 0 — Fundação & arquitetura
**Objetivo:** esqueleto do SaaS de pé.
**Funcionalidades:** monorepo (pnpm/Turborepo), CI, projeto Supabase, schema base + migrations, autenticação (signup/login), modelo de `Workspace` + `WorkspaceMember` + **políticas RLS** por `workspace_id`, design system base, i18n pt-BR, esqueleto de fila (Redis/BullMQ).
**Entregável:** usuário faz login, cria um workspace pessoal e (stub) convida membro.
**Pronto:** RLS comprovadamente bloqueia acesso cross-workspace em teste automatizado.

### Fase 1 — Núcleo financeiro (MVP manual)
**Objetivo:** dá pra controlar finanças de ponta a ponta manualmente.
**Funcionalidades:** CRUD de contas/carteiras; categorias (seed de defaults BR) e tags; lançamento manual rápido (receita/despesa/**transferência**); listagem com filtros (período, conta, categoria, busca); dashboard básico (saldo consolidado, receita×despesa do mês, top categorias, evolução).
**Entregável:** workspace pessoal utilizável de verdade.
**Pronto:** saldos batem após sequência de receitas/despesas/transferências.

### Fase 2 — Ingestão por IA (o diferencial)
**Objetivo:** matar o atrito do lançamento.
**Funcionalidades:** upload de **foto** (comprovante/Pix/nota) → fila → OpenRouter (visão) → transação pré-preenchida; **texto livre** ("almoço 35 no ifood ontem") → parse; **voz** (áudio → Whisper/Groq → texto → parse); tela de **revisão/confirmação** com nível de confiança; reprocessamento e correção.
**Entregável:** lançar por foto/voz/texto com confirmação humana.
**Pronto:** taxa de campos corretos no parse acima de meta definida em conjunto de teste rotulado.

### Fase 3 — Import em lote
**Objetivo:** trazer histórico e faturas.
**Funcionalidades:** **CSV** com mapeamento de colunas (salva mapeamento por banco); **OFX**; **fatura de cartão em PDF** (IA extrai linhas); **deduplicação** e conciliação com lançamentos existentes.
**Entregável:** importar extrato/fatura sem duplicar.
**Pronto:** import idempotente (reimportar o mesmo arquivo não duplica).

### Fase 4 — Inteligência
**Objetivo:** virar registro em insight.
**Funcionalidades:** **categorização automática** com feedback loop (regras + LLM; aprende com correções); **detecção de anomalias** (picos, assinaturas recorrentes esquecidas, "gastos fantasmas"); **previsão de saldo/fluxo**; **resumo mensal** narrado; **orçamentos** (fixos e 50/30/20) e **metas/cofrinhos** com alertas.
**Entregável:** insights e orçamentos rodando com alertas.
**Pronto:** anomalia injetada em dados de teste é detectada; orçamento estoura → alerta dispara.

### Fase 5 — Colaboração (Família & PJ)
**Objetivo:** habilitar workspaces compartilhados e PJ.
**Funcionalidades:** workspace **familiar** (convites, papéis, despesas compartilhadas/divisão); workspace **PJ** (separação PF/PJ, campos fiscais básicos, centro de custo); **RBAC completo** reforçado por RLS; troca rápida de workspace.
**Entregável:** família e PJ funcionais com permissões corretas.
**Pronto:** `viewer` não consegue criar/editar; membro de um workspace não vê outro.

### Fase 6 — Chat "pergunte às suas finanças"
**Objetivo:** consulta em linguagem natural.
**Funcionalidades:** NL → consulta **segura** (function calling sobre a API **ou** text-to-SQL restrito a views read-only, sempre filtrado por `workspace_id`); respostas com gráficos; relatórios narrados.
**Entregável:** chat de consulta com guardrails.
**Pronto:** tentativas de query fora do workspace do usuário são bloqueadas (teste de segurança).

### Fase 7 — Open Finance (sincronização bancária)
**Objetivo:** automatizar a entrada via banco.
**Funcionalidades:** integração via agregador BR (**Pluggy** ou **Belvo**), fluxo de consentimento, sync automático, conciliação com lançamentos manuais/IA.
**Entregável:** contas bancárias sincronizando.
**Pronto:** transação do banco concilia com lançamento manual equivalente sem duplicar.

### Fase 8 — PWA & engajamento
**Objetivo:** app instalável e retenção.
**Funcionalidades:** PWA offline-first, **push notifications** (lembrete de contas, alerta de orçamento), atalhos de lançamento (compartilhar foto direto pro app), polimento mobile, exportação (CSV/PDF), backup.
**Entregável:** app instalável com notificações.
**Pronto:** funciona offline pra consulta; push de vencimento chega.

---

## 7. Camada de IA em detalhe

**Gateway:** OpenRouter como cliente único; modelo configurável por tarefa via env (não acoplar a um modelo específico no código — o catálogo muda rápido; **verifique os modelos atuais no OpenRouter na hora de implementar**).

**Seleção de modelo por tarefa (por capacidade, não por nome fixo):**

| Tarefa | Capacidade necessária | Estratégia de custo |
|---|---|---|
| Parse de comprovante | Multimodal/visão | Só chama visão quando há imagem |
| Parse de texto/voz | LLM rápido e barato | Texto curto, prompt enxuto |
| Categorização | LLM barato + regras | Regra primeiro; LLM só no que sobra |
| Insights/anomalias | LLM de raciocínio (ex.: família DeepSeek que você já usa) | Job agendado em lote |
| Chat | LLM bom em function calling | Limite de contexto por workspace |

**Structured output:** usar `response_format` com JSON schema; validar com **Zod**; rotina de *repair* quando o JSON vier malformado. Jamais confiar cegamente — tudo passa por revisão humana até a confiança calibrar (Fase 2).

**Voz:** áudio → Whisper (Groq) → texto → parser LLM (mesmo caminho do texto). Reaproveita seu pipeline.

**Feedback loop de categorização:** cada correção do usuário vira sinal (regra explícita "fornecedor X → categoria Y" e/ou exemplo few-shot por workspace), aumentando a precisão sem retreino.

**Controle de custo:** jobs em fila com retry/backoff; cache de respostas idênticas; orçamento de tokens por usuário/plano; registrar custo em `AIJob` pra precificar.

---

## 8. Segurança, privacidade e LGPD

Dado financeiro é **sensível** — isso é requisito, não enfeite.

- **Isolamento multi-tenant:** RLS no Postgres por `workspace_id` como defesa em profundidade, além das checagens no app. Testes automatizados de isolamento são obrigatórios (Fases 0 e 5).
- **Criptografia:** TLS em trânsito; criptografia em repouso (Supabase); comprovantes em Storage com **signed URLs** e policies por workspace.
- **IA e privacidade:** consentimento explícito pro processamento por IA; deixar claro que dados trafegam por OpenRouter/Groq; preferir provedores com política de **não-retenção (ZDR)**; considerar **mascarar dados sensíveis** antes do envio quando viável; permitir opt-out (cair pro manual).
- **LGPD:** base legal definida; direitos do titular (exportar/excluir dados); política de retenção; `AuditLog` de ações sensíveis; registro de tratamento.
- **Conta:** 2FA, rate limiting, rotação de tokens, least privilege nas service keys.

---

## 9. Stack e infraestrutura (resumo)

- **Monorepo:** pnpm + Turborepo (`apps/web`, `apps/api`, `apps/worker`, `packages/shared`).
- **Shared:** tipos + schemas Zod compartilhados entre front e back.
- **Deploy:** Vercel (web), Railway (api, worker, Redis), Supabase (db/auth/storage).
- **Observabilidade:** logs estruturados, métricas de fila (jobs, falhas, custo de IA), alertas.

---

## 10. Riscos e decisões em aberto

| # | Decisão/risco | Recomendação |
|---|---|---|
| 1 | Ledger simples **vs** partida dobrada | Começar quase-double-entry (transfer com origem/destino); evoluir pra partida dobrada no rigor PJ |
| 2 | NestJS **vs** Express/Fastify puro | NestJS pela estrutura de RBAC/módulos num SaaS que cresce; Express se priorizar velocidade inicial |
| 3 | Supabase **vs** stack própria | Supabase pelo RLS+Auth+Storage prontos (você já usa); reavaliar se lock-in incomodar |
| 4 | Agregador Open Finance (Fase 7) | Comparar Pluggy × Belvo por custo/cobertura na época |
| 5 | Monetização | Definir cedo: limites de IA por plano impactam arquitetura de billing |
| 6 | Custo de IA por usuário | Medir em `AIJob` desde a Fase 2 pra precificar com dados reais |

---

## 11. Como executar (handoff para o seu fluxo)

Este documento é o **roadmap**. Para executar, trate **cada fase como um mini-projeto** dentro do seu ecossistema Superpowers:

1. **`brainstorming`** — refinar requisitos e UX da fase (vira o "spec").
2. **`writing-plans`** — transformar o spec da fase em tarefas TDD bite-sized com caminhos de arquivo e código.
3. **`using-git-worktrees`** — isolar o workspace da fase.
4. **`subagent-driven-development`** (recomendado) — subagente fresco por tarefa + review entre tarefas; ou **`executing-plans`** pra execução inline com checkpoints.
5. **`verification-before-completion`** + **`requesting-code-review`** antes de fechar a fase.

**Sequência sugerida de entrega:** Fase 0 → 1 → 2 (diferencial cedo, valida a tese de IA) → 3 → 4 → 5 → 6 → 7 → 8.

> Sobre a dúvida que você tinha entre subagent-driven e inline: pra fases com tarefas bem independentes (0, 1, 3) o **subagent-driven** rende mais; pra fases com forte acoplamento de contexto (6 e o chat com guardrails) o **inline com checkpoints** tende a ser mais seguro.
