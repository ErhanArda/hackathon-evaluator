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
  const [token, setToken] = useState("");
  const [teams, setTeams] = useState(initialTeams);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [members, setMembers] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function addTeam(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/teams", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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
    const res = await fetch(`/api/teams/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setMsg(`Silinemedi: ${res.status}`);
      return;
    }
    setTeams(teams.filter((t) => t.id !== id));
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Bu sayfa yazma işlemleri için <code>INGEST_TOKEN</code> ister. Token tarayıcıda saklanmaz; her oturumda gir.
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium">INGEST_TOKEN</label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Bearer token"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <form onSubmit={addTeam} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">Takım Ekle / Güncelle</h2>
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
          disabled={busy || !token}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Ekleniyor..." : "Ekle"}
        </button>
        {msg && <p className="text-xs text-slate-600">{msg}</p>}
      </form>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-base font-semibold">
          Mevcut Takımlar ({teams.length})
        </div>
        <ul className="divide-y divide-slate-100">
          {teams.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-slate-500">{t.repoUrl}</div>
              </div>
              <button
                onClick={() => deleteTeam(t.id)}
                disabled={!token}
                className="text-xs text-rose-600 hover:underline disabled:opacity-40"
              >
                Sil
              </button>
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
