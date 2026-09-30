import { BadRequestException } from "@nestjs/common";
import { ACCOUNT_ENTITIES, type AccountEntity } from "@app/shared";

/** Converte o parâmetro `?entity=` (ausente, vazio, pf ou pj) em `AccountEntity | undefined`. */
export function parseEntityQuery(value?: string): AccountEntity | undefined {
  if (value === undefined || value === "") return undefined;
  if ((ACCOUNT_ENTITIES as readonly string[]).includes(value)) return value as AccountEntity;
  throw new BadRequestException("entity deve ser pf ou pj");
}
