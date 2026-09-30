import { BadRequestException } from "@nestjs/common";
import { CATEGORY_TYPES, type CategoryType } from "@app/shared";

/** Converte `?type=` (ausente, vazio, income ou expense) em `CategoryType | undefined`. */
export function parseCategoryTypeQuery(value?: string): CategoryType | undefined {
  if (value === undefined || value === "") return undefined;
  if ((CATEGORY_TYPES as readonly string[]).includes(value)) return value as CategoryType;
  throw new BadRequestException("type deve ser income ou expense");
}
