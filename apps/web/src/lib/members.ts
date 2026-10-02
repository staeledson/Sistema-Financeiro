/** O usuário atual pode gerenciar membros (owner ou admin) neste workspace. */
export function canManageMembers(members: Array<{ role: string; user: { id: string } }>, userId: string | null): boolean {
  if (!userId) return false;
  const me = members.find((m) => m.user.id === userId);
  return me?.role === "owner" || me?.role === "admin";
}
