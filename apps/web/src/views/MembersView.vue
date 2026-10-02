<template>
  <div class="members-view">
    <div class="view-header">
      <div>
        <h2>Membros</h2>
        <p class="subtitle">Workspace: {{ wsStore.active?.name }}</p>
      </div>
    </div>

    <EmptyState v-if="loading" title="Carregando…" />

    <template v-else>
      <section class="members-section">
        <h3>Membros atuais</h3>
        <div class="members-list">
          <div v-for="m in members" :key="m.user.id" class="member-row">
            <div class="member-info">
              <span class="member-name">{{ m.user.name }}</span>
              <span class="member-email">{{ m.user.email }}</span>
            </div>
            <select v-if="canManage && m.role !== 'owner'" :value="m.role" @change="changeRole(m, ($event.target as HTMLSelectElement).value)">
              <option value="admin">Admin</option>
              <option value="member">Membro</option>
              <option value="viewer">Leitor</option>
            </select>
            <span v-else class="role-badge" :class="m.role">{{ m.role }}</span>
            <button v-if="canManage && m.role !== 'owner'" type="button" class="btn-remove btn-small" @click="removeMember(m)">Remover</button>
          </div>
        </div>
      </section>

      <section v-if="canManage" class="invite-section">
        <h3>Convidar</h3>
        <div class="invite-form">
          <input v-model="inviteEmail" type="email" placeholder="email@exemplo.com" />
          <select v-model="inviteRole">
            <option value="member">Membro</option>
            <option value="admin">Admin</option>
            <option value="viewer">Leitor</option>
          </select>
          <button type="button" class="btn-primary" :disabled="sending || !inviteEmail" @click="sendInvite">
            {{ sending ? "Enviando…" : "Convidar" }}
          </button>
        </div>
        <p v-if="inviteMsg" :class="['invite-msg', inviteError ? 'error' : 'success']">{{ inviteMsg }}</p>
      </section>

      <section v-if="canManage && invitations.length" class="pending-section">
        <h3>Convites pendentes</h3>
        <div class="invitations-list">
          <div v-for="inv in invitations" :key="inv.id" class="invitation-row">
            <span>{{ inv.email }}</span>
            <span class="role-badge" :class="inv.role">{{ inv.role }}</span>
            <span class="inv-expires">expira {{ inv.expiresAt.slice(0, 10) }}</span>
            <button type="button" class="btn-remove btn-small" @click="revokeInvitation(inv)">Revogar</button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useWorkspaceStore } from "../stores/workspace";
import { useAuthStore } from "../stores/auth";
import { canManageMembers } from "../lib/members";
import { http, HttpError } from "../lib/http";
import EmptyState from "../components/ui/EmptyState.vue";

const wsStore = useWorkspaceStore();
const auth = useAuthStore();

const members = ref<any[]>([]);
const invitations = ref<any[]>([]);
const loading = ref(true);
const inviteEmail = ref("");
const inviteRole = ref("member");
const sending = ref(false);
const inviteMsg = ref("");
const inviteError = ref(false);

const canManage = computed(() => canManageMembers(members.value, auth.userId));

async function loadAll() {
  if (!wsStore.activeId) return;
  loading.value = true;
  try {
    const [m, i] = await Promise.all([
      http<any[]>("GET", `/workspaces/${wsStore.activeId}/members`).catch(() => []),
      http<any[]>("GET", "/invitations").catch(() => []),
    ]);
    members.value = m;
    invitations.value = i;
  } finally {
    loading.value = false;
  }
}
async function changeRole(member: any, role: string) {
  try {
    await http("PATCH", `/workspaces/${wsStore.activeId}/members/${member.user.id}/role`, { role });
    member.role = role;
  } catch { /* mantém o papel anterior */ }
}
async function removeMember(member: any) {
  if (!confirm(`Remover ${member.user.name}?`)) return;
  try {
    await http("DELETE", `/workspaces/${wsStore.activeId}/members/${member.user.id}`);
    members.value = members.value.filter((m) => m.user.id !== member.user.id);
  } catch (e) {
    alert(e instanceof HttpError ? e.message : "Erro ao remover membro");
  }
}
async function sendInvite() {
  sending.value = true;
  inviteMsg.value = "";
  inviteError.value = false;
  try {
    const data = await http<{ token: string }>("POST", "/invitations", { email: inviteEmail.value, role: inviteRole.value });
    inviteMsg.value = `Convite enviado! Token: ${data.token}`;
    inviteEmail.value = "";
    await loadAll();
  } catch (e) {
    inviteMsg.value = e instanceof HttpError ? e.message : "Erro ao convidar";
    inviteError.value = true;
  } finally {
    sending.value = false;
  }
}
async function revokeInvitation(inv: any) {
  try {
    await http("DELETE", `/invitations/${inv.id}`);
    invitations.value = invitations.value.filter((i) => i.id !== inv.id);
  } catch { /* mantém a lista */ }
}

onMounted(loadAll);
</script>

<style scoped>
.members-view { padding: 1.5rem; max-width: 720px; margin: 0 auto; }
.view-header { margin-bottom: 1.5rem; }
.view-header h2 { font-size: 1.4rem; font-weight: 600; }
.subtitle { font-size: 0.875rem; color: var(--text-muted); margin-top: 0.2rem; }
section { margin-bottom: 2rem; }
h3 { font-size: 1rem; font-weight: 600; margin-bottom: 0.75rem; color: var(--text-muted); }
.members-list, .invitations-list { display: flex; flex-direction: column; gap: 0.5rem; }
.member-row, .invitation-row {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--surface);
  border: 1px solid var(--border); border-radius: calc(var(--radius) / 1.5);
}
.member-info { flex: 1; }
.member-name { display: block; font-size: 0.9rem; font-weight: 500; }
.member-email { display: block; font-size: 0.75rem; color: var(--text-muted); }
.role-badge {
  font-size: 0.7rem; text-transform: uppercase; letter-spacing: .04em;
  padding: 0.2rem 0.5rem; border-radius: 0.3rem; background: var(--surface-2); color: var(--text-muted);
}
.role-badge.owner { background: color-mix(in srgb, var(--warning) 15%, transparent); color: var(--warning); }
.role-badge.admin { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); }
.inv-expires { font-size: 0.75rem; color: var(--text-muted); }
select { font-size: 0.8rem; padding: 0.3rem 0.5rem; }
.btn-remove { background: transparent; border-color: var(--danger); color: var(--danger); }
.invite-form { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.invite-form input { flex: 1; min-width: 180px; }
.invite-msg { margin-top: 0.5rem; font-size: 0.85rem; }
.invite-msg.success { color: var(--c-income); }
.invite-msg.error { color: var(--danger); }
</style>
