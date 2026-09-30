import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../http", () => ({ http: vi.fn(async () => []) }));

import { http } from "../http";
import { api } from "../api";

const lastCall = () => {
  const calls = vi.mocked(http).mock.calls;
  return (calls[calls.length - 1] ?? []).slice(0, 3);
};

beforeEach(() => vi.mocked(http).mockClear());

describe("api — entidade PF/PJ", () => {
  it("accounts.list envia ?entity= só quando informado", async () => {
    await api.accounts.list();
    expect(lastCall()).toEqual(["GET", "/accounts", undefined]);
    await api.accounts.list("pj");
    expect(lastCall()).toEqual(["GET", "/accounts?entity=pj", undefined]);
  });

  it("accounts.update usa PATCH /accounts/:id", async () => {
    await api.accounts.update("a1", { entity: "pj" });
    expect(lastCall()).toEqual(["PATCH", "/accounts/a1", { entity: "pj" }]);
  });

  it("categories.list combina type e entity", async () => {
    await api.categories.list();
    expect(lastCall()[1]).toBe("/categories");
    await api.categories.list("expense", "pj");
    expect(lastCall()[1]).toBe("/categories?type=expense&entity=pj");
    await api.categories.list(undefined, "pf");
    expect(lastCall()[1]).toBe("/categories?entity=pf");
  });

  it("transactions.list inclui entity na query string", async () => {
    await api.transactions.list({ entity: "pf", accountId: "a1" });
    expect(lastCall()[1]).toBe("/transactions?accountId=a1&entity=pf");
  });
});
