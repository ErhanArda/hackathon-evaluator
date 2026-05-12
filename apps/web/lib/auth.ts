import { NextRequest } from "next/server";

export function checkBearer(req: NextRequest): boolean {
  const expected = process.env.INGEST_TOKEN;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  return m[1].trim() === expected;
}
