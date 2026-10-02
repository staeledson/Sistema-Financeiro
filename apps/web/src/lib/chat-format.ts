const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** Texto do modelo → HTML seguro: escapa tudo e só então aplica negrito (`**x**`) e quebras de linha. */
export function formatChatText(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
