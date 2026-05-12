export function SetupBanner() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
      <div className="font-semibold">⚠ Veritabanı bağlı değil</div>
      <p className="mt-2">
        <code className="rounded bg-amber-100 px-1">POSTGRES_URL</code> set değil. Lokalde
        <code className="rounded bg-amber-100 px-1 mx-1">apps/web/.env.local</code>'a ekle, ya da Vercel'de
        Storage → Postgres ile bağla.
      </p>
      <pre className="mt-3 rounded bg-amber-100 p-2 text-xs">
{`# apps/web/.env.local
POSTGRES_URL=postgresql://user:pass@host:5432/db?sslmode=require`}
      </pre>
    </div>
  );
}
