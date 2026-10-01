import { describe, expect, it } from "vitest";
import { useSection } from "../use-section";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("useSection", () => {
  it("carrega e guarda os dados", async () => {
    const s = useSection(async () => 42);
    const p = s.run();
    expect(s.loading.value).toBe(true);
    await p;
    expect(s.data.value).toBe(42);
    expect(s.loading.value).toBe(false);
    expect(s.error.value).toBe("");
  });

  it("descarta a resposta antiga quando outra chamada começou depois", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const queue = [first, second];
    const s = useSection(() => queue.shift()!.promise);
    const a = s.run();
    const b = s.run();
    second.resolve("novo");
    await b;
    first.resolve("antigo");
    await a;
    expect(s.data.value).toBe("novo");
    expect(s.loading.value).toBe(false);
  });

  it("erro antigo também é descartado; erro atual aparece", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const queue = [first, second];
    const s = useSection(() => queue.shift()!.promise);
    const a = s.run();
    const b = s.run();
    first.reject(new Error("velho"));
    await a;
    expect(s.error.value).toBe("");
    expect(s.loading.value).toBe(true);
    second.reject(new Error("falhou"));
    await b;
    expect(s.error.value).toBe("falhou");
    expect(s.loading.value).toBe(false);
  });
});
