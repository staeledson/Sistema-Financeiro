-- Backfill da Reserva Emergência do Mercado Pago (executar uma vez na produção, depois de publicar a importação nova).
--
-- Antes: "Reserva por gastos", "Reserva programada" (despesa) e "Dinheiro retirado Reserva" (receita) eram contados
-- como despesa e receita, inflando os dois lados. Agora são transferências entre a conta e a conta "Reserva Emergência".
-- O saldo da conta do Mercado Pago NÃO muda (a transferência subtrai/soma na conta de origem/destino como antes).
--
-- Duas instruções, cada uma idempotente (rodar de novo não muda nada). Execute uma por vez, na ordem.
-- Antes de rodar: a conta do Mercado Pago precisa estar com institution = 'mercado_pago' (o padrão da coluna é 'other'),
-- e não pode haver job de categorização em andamento (ele poderia reescrever a categoria de uma linha recém-convertida).
-- Depois de rodar: ajuste o saldo inicial da Reserva (ou concilie com o valor real do app), porque ela nasce com 0 e só
-- recebe o líquido do que foi importado; sem isso o saldo dela fica negativo e puxa para baixo o saldo PF.
-- Reverter não é automático: a categoria apagada pelo passo 2 não volta (os movimentos de reserva não tinham categoria útil).

-- 1) Cria a conta "Reserva Emergência" (poupança, PF, Mercado Pago) só nos workspaces que têm conta corrente PF do
--    Mercado Pago COM lançamentos de reserva e ainda não têm uma poupança PF do Mercado Pago ativa.
INSERT INTO bank_accounts (id, "workspaceId", type, name, "openingBalanceCents", archived, entity, institution, "createdAt")
SELECT 'rsv_' || md5(x."workspaceId" || clock_timestamp()::text), x."workspaceId", 'savings'::"AccountType", 'Reserva Emergência', 0, false,
       'pf'::"AccountEntity", 'mercado_pago'::"Institution", now()
FROM (
  SELECT DISTINCT a."workspaceId"
  FROM bank_accounts a
  WHERE a.institution = 'mercado_pago' AND a.entity = 'pf' AND a.type = 'checking' AND NOT a.archived
    AND EXISTS (
      SELECT 1 FROM transactions m
      WHERE m."accountId" = a.id AND m."transferPairId" IS NULL
        AND ((m.type = 'expense' AND m.description ~* '^\s*reserva (por gastos|programada)')
          OR (m.type = 'income' AND m.description ~* '^\s*dinheiro retirado reserva'))
    )
    AND NOT EXISTS (
      SELECT 1 FROM bank_accounts s
      WHERE s."workspaceId" = a."workspaceId" AND s.type = 'savings' AND s.entity = 'pf' AND s.institution = 'mercado_pago' AND NOT s.archived
    )
) x;

-- 2) Converte os movimentos de reserva já importados em transferência (só onde a conta de reserva é única: mesma
--    entidade e instituição). Guardar: conta -> reserva. Retirar: reserva -> conta. Fora da fila e das despesas.
WITH r AS (
  SELECT a.id AS src, (array_agg(s.id))[1] AS rid
  FROM bank_accounts a
  JOIN bank_accounts s
    ON s."workspaceId" = a."workspaceId" AND s.type = 'savings' AND NOT s.archived AND s.entity = a.entity AND s.institution = a.institution
  WHERE a.institution = 'mercado_pago' AND a.type NOT IN ('savings', 'credit_card')
  GROUP BY a.id
  HAVING count(*) = 1
)
UPDATE transactions t
SET type = 'transfer',
    "sourceAccountId" = CASE WHEN t.type = 'expense' THEN t."accountId" ELSE r.rid END,
    "destAccountId" = CASE WHEN t.type = 'expense' THEN r.rid ELSE t."accountId" END,
    "categoryId" = NULL, "categorySource" = 'none', "reviewStatus" = 'ok', "suggestedCategoryId" = NULL, "categoryConfidence" = NULL,
    ignored = false
FROM r
WHERE t."accountId" = r.src AND t."transferPairId" IS NULL
  AND ((t.type = 'expense' AND t.description ~* '^\s*reserva (por gastos|programada)')
    OR (t.type = 'income' AND t.description ~* '^\s*dinheiro retirado reserva'));
