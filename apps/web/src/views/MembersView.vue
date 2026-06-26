<template>
  <div class="members-view">
    <div class="view-header">
      <div>
        <h2>Membros</h2>
        <p class="subtitle">Workspace: {{ wsStore.active?.name }}</p>
      </div>
    </div>

    <div v-if="loading" class="empty-state">Carregando…</div>

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
            <button v-if="canManage && m.role !== 'owner'" class="btn-remove" @click="removeMember(m)">Remover</button>
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
          <button class="btn-primary" :disabled="sending || !inviteEmail" @click="sendInvite">
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
            <button class="btn-remove" @click="revokeInvitation(inv)">Revogar</button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useWorkspaceStore } from "../stores/workspace";

const wsStore = useWorkspaceStore();

const members = ref<any[]>([]);
const invitations = ref<any[]>([]);
const loading = ref(true);
const inviteEmail = ref("");
const inviteRole = ref("member");
const sending = ref(false);
const inviteMsg = ref("");
const inviteError = ref(false);

const canManage = computed(() => {
  const me = members.value.find((m) => m.role === "owner" || m.role === "admin");
  return !!me;
});

async function loadAll() {
  if (!wsStore.activeId) return;
  loading.value = true;
  try {
    const [mRes, iRes] = await Promise.all([
      fetch(`/api/workspaces/${wsStore.activeId}/members`, { headers: wsStore.headers() }),
      fetch("/api/invitations", { headers: wsStore.headers() }),
    ]);
    members.value = mRes.ok ? await mRes.json() : [];
    invitations.value = iRes.ok ? await iRes.json() : [];
  } finally {
    loading.value = false;
  }
}

async function changeRole(member: any, role: string) {
  const res = await fetch(`/api/workspaces/${wsStore.activeId}/members/${member.user.id}/role`, {
    method: "PATCH",
    headers: wsStore.headers(),
    body: JSON.stringify({ role }),
  });
  if (res.ok) {
    member.role = role;
  }
}

async function removeMember(member: any) {
  if (!confirm(`Remover ${member.user.name}?`)) return;
  const res = await fetch(`/api/workspaces/${wsStore.activeId}/members/${member.user.id}`, {
    method: "DELETE",
    headers: { authorization: wsStore.headers().authorization },
  });
  if (res.ok) {
    members.value = members.value.filter((m) => m.user.id !== member.user.id);
  } else {
    const body = await res.json().catch(() => ({}));
    alert(body.message ?? "Erro ao remover membro");
  }
}

async function sendInvite() {
  sending.value = true;
  inviteMsg.value = "";
  inviteError.value = false;
  try {
    const res = await fetch("/api/invitations", {
      method: "POST",
      headers: wsStore.headers(),
      body: JSON.stringify({ email: inviteEmail.value, role: inviteRole.value }),
    });
    if (res.ok) {
      const data = await res.json();
      inviteMsg.value = `Convite enviado! Token: ${data.token}`;
      inviteEmail.value = "";
      await loadAll();
    } else {
      const body = await res.json().catch(() => ({}));
      inviteMsg.value = body.message ?? "Erro ao convidar";
      inviteError.value = true;
    }
  } finally {
    sending.value = false;
  }
}

async function revokeInvitation(inv: any) {
  const res = await fetch(`/api/invitations/${inv.id}`, {
    method: "DELETE",
    headers: { authorization: wsStore.headers().authorization },
  });
  if (res.ok) {
    invitations.value = invitations.value.filter((i) => i.id !== inv.id);
  }
}

onMounted(loadAll);
</script>

<style scoped>
.members-view { padding: 1.5rem; max-width: 720px; margin: 0 auto; }
.view-header { margin-bottom: 1.5rem; }
.view-header h2 { font-size: 1.4rem; font-weight: 600; }
.subtitle { font-size: 0.875rem; color: #888; margin-top: 0.2rem; }
.empty-state { text-align: center; padding: 3rem; color: #888; }
section { margin-bottom: 2rem; }
h3 { font-size: 1rem; font-weight: 600; margin-bottom: 0.75rem; color: #aaa; }
.members-list, .invitations-list { display: flex; flex-direction: column; gap: 0.5rem; }
.member-row, .invitation-row {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--color-surface, #1a1a2e);
  border: 1px solid #333; border-radius: 0.5rem;
}
.member-info { flex: 1; }
.member-name { display: block; font-size: 0.9rem; font-weight: 500; }
.member-email { display: block; font-size: 0.75rem; color: #888; }
.role-badge {
  font-size: 0.7rem; text-transform: uppercase; letter-spacing: .04em;
  padding: 0.2rem 0.5rem; border-radius: 0.3rem; background: rgba(255,255,255,.08);
}
.role-badge.owner { background: rgba(250,204,21,.15); color: #fbbf24; }
.role-badge.admin { background: rgba(79,124,255,.15); color: #4f7cff; }
.inv-expires { font-size: 0.75rem; color: #888; }
select {
  padding: 0.3rem 0.5rem; background: rgba(255,255,255,.05);
  border: 1px solid #444; border-radius: 0.35rem;
  color: var(--color-text, #fff); font-size: 0.8rem;
}
.btn-remove {
  padding: 0.3rem 0.65rem; background: transparent;
  border: 1px solid #f87171; color: #f87171;
  border-radius: 0.35rem; cursor: pointer; font-size: 0.8rem;
}
.invite-form { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.invite-form input {
  flex: 1; min-width: 180px;
  padding: 0.5rem 0.75rem; background: rgba(255,255,255,.05);
  border: 1px solid #444; border-radius: 0.4rem;
  color: var(--color-text, #fff); font-size: 0.9rem;
}
.btn-primary { padding: 0.5rem 1rem; background: var(--color-primary, #4f7cff); color: #fff; border: none; border-radius: 0.4rem; cursor: pointer; font-size: 0.875rem; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.invite-msg { margin-top: 0.5rem; font-size: 0.85rem; }
.invite-msg.success { color: #4ade80; }
.invite-msg.error { color: #f87171; }
</style>
