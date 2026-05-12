import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hackathon Repo Evaluator",
  description: "Sub-agent powered repo scoring for hackathon teams",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-4">
            <a href="/" className="text-lg font-semibold tracking-tight">
              🏆 Hackathon Repo Evaluator
            </a>
            <nav className="flex gap-4 text-sm">
              <a href="/" className="text-slate-600 hover:text-slate-900">Leaderboard</a>
              <a href="/api/export.xlsx" className="text-slate-600 hover:text-slate-900">Excel</a>
              <a href="/admin" className="text-slate-600 hover:text-slate-900">Admin</a>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
        <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
          Sub-agent destekli puanlama · Claude Code orchestrator + Vercel + Neon
        </footer>
      </body>
    </html>
  );
}
