/**
 * O papel `viewer` só lê. As exceções são ações que não tocam o financeiro do workspace:
 * aceitar outro convite, criar o próprio workspace, inscrever push e conversar com o chat (que só consulta).
 */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const VIEWER_WRITE_ALLOWLIST: RegExp[] = [/^\/invitations\/accept$/, /^\/workspaces$/, /^\/push\/subscribe$/, /^\/chat$/];

export function viewerMayCall(method: string, url: string): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return true;
  const path = url.split("?")[0].replace(/\/+$/, "");
  return VIEWER_WRITE_ALLOWLIST.some((re) => re.test(path));
}
