import { API_BASE, authHeaders, HttpError } from "./http";

/** Baixa o CSV completo de lançamentos (conta, PF/PJ, categoria, par, ignorado) para análise fora do app. */
export async function downloadAnalysisCsv(): Promise<void> {
  const res = await fetch(`${API_BASE}/export/analise.csv`, { headers: authHeaders() });
  if (!res.ok) throw new HttpError(res.status, "Não foi possível exportar os lançamentos.", await res.text());
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "analise-lancamentos.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
