"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Team = {
  id: string;
  name: string;
  repoUrl: string;
  members: string[] | null;
};

export function AdminPanel({ initialTeams }: { initialTeams: Team[] }) {
  const router = useRouter();
  const [teams, setTeams] = useState(initialTeams);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [members, setMembers] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRepoUrl, setEditRepoUrl] = useState("");
  const [editMembers, setEditMembers] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  function startEdit(t: Team) {
    setEditingId(t.id);
    setEditName(t.name);
    setEditRepoUrl(t.repoUrl);
    setEditMembers((t.members ?? []).join(", "));
    setMsg(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: string) {
    setEditBusy(true);
    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        name: editName.trim(),
        repoUrl: editRepoUrl.trim(),
        members: editMembers.split(",").map((m) => m.trim()).filter(Boolean),
      }),
    });
    setEditBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMsg(`Hata: ${data.error ?? res.status}`);
      return;
    }
    const data = await res.json();
    setTeams(
      teams
        .map((t) => (t.id === id ? data.team : t))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    setEditingId(null);
    setMsg(`Güncellendi: ${data.team.name}`);
    router.refresh();
  }

  async function addTeam(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        repoUrl: repoUrl.trim(),
        members: members.split(",").map((m) => m.trim()).filter(Boolean),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMsg(`Hata: ${data.error ?? res.status}`);
      return;
    }
    const data = await res.json();
    setTeams([...teams.filter((t) => t.id !== data.team.id), data.team].sort((a, b) => a.name.localeCompare(b.name)));
    setName("");
    setRepoUrl("");
    setMembers("");
    setMsg(`Eklendi: ${data.team.name}`);
    router.refresh();
  }

  async function deleteTeam(id: string) {
    if (!confirm("Silinsin mi?")) return;
    const res = await fetch(`/api/teams/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setMsg(`Silinemedi: ${res.status}`);
      return;
    }
    setTeams(teams.filter((t) => t.id !== id));
    if (editingId === id) setEditingId(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* ADD form (sadece yeni takım) */}
      <form onSubmit={addTeam} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">Takım Ekle</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Takım adı"
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/team/repo"
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <input
          value={members}
          onChange={(e) => setMembers(e.target.value)}
          placeholder="Üyeler (virgülle ayır)"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Ekleniyor..." : "Ekle"}
        </button>
        {msg && <p className="text-xs text-slate-600">{msg}</p>}
      </form>

      {/* TEAM list (inline edit) */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-base font-semibold">
          Mevcut Takımlar ({teams.length})
        </div>
        <ul className="divide-y divide-slate-100">
          {teams.map((t) => (
            <li key={t.id} className="px-4 py-3 text-sm">
              {editingId === t.id ? (
                // EDIT MODE
                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Takım adı"
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                    <input
                      value={editRepoUrl}
                      onChange={(e) => setEditRepoUrl(e.target.value)}
                      placeholder="https://github.com/..."
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </div>
                  <input
                    value={editMembers}
                    onChange={(e) => setEditMembers(e.target.value)}
                    placeholder="Üyeler (virgülle ayır)"
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => saveEdit(t.id)}
                      disabled={editBusy}
                      className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {editBusy ? "Kaydediliyor..." : "Kaydet"}
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={editBusy}
                      className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      İptal
                    </button>
                    <span className="ml-auto text-xs text-slate-400">id: {t.id}</span>
                  </div>
                </div>
              ) : (
                // VIEW MODE
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{t.name}</div>
                    <div className="truncate text-xs text-slate-500">{t.repoUrl}</div>
                    {t.members && t.members.length > 0 && (
                      <div className="text-xs text-slate-400">{t.members.join(", ")}</div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      onClick={() => startEdit(t)}
                      className="text-xs text-slate-700 hover:underline"
                    >
                      Düzenle
                    </button>
                    <button
                      onClick={() => deleteTeam(t.id)}
                      className="text-xs text-rose-600 hover:underline"
                    >
                      Sil
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
          {teams.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-slate-400">Takım yok.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
