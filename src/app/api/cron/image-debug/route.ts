import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/verify-cron";
import { resolveNewsImage } from "@/lib/newsletter-template";
import { fetchRemoteImage } from "@/lib/fetch-remote-image";

// 임시 점검용(확인 후 삭제) — 뉴스레터 생성 때와 같은 이미지 판정을 운영 환경에서 그대로 실행해 결과·시간을 돌려줌
export const maxDuration = 60;

export async function GET(req: Request) {
  const unauth = verifyCronAuth(req);
  if (unauth) return unauth;
  const { searchParams } = new URL(req.url);
  const urls = (searchParams.get("urls") ?? "").split("|").filter(Boolean);
  const load = Math.min(40, Number(searchParams.get("load") ?? 0));   // 같은 판정을 동시에 N개 더 돌려 부하 상황 재현
  const site = "https://ez-newsroom.vercel.app";
  const one = async (u: string) => {
    const t0 = Date.now();
    const direct = await fetchRemoteImage(u, 8000);
    const directMs = Date.now() - t0;
    void direct?.body?.cancel().catch(() => {});
    const t1 = Date.now();
    const resolved = await resolveNewsImage(u, site);
    return { url: u, directOk: !!direct, directMs, resolvedNull: resolved === null, resolveMs: Date.now() - t1 };
  };
  const single = await Promise.all(urls.map(one));
  let underLoad: unknown = null;
  if (load > 0 && urls.length) {
    const extra = Array.from({ length: load }, (_, i) => resolveNewsImage(urls[i % urls.length], site));
    const t = Date.now();
    const rs = await Promise.all([...urls.map(one), ...extra]);
    underLoad = { ms: Date.now() - t, firstResults: (rs.slice(0, urls.length) as { url: string; resolvedNull: boolean; resolveMs: number }[]).map((r) => ({ url: r.url, resolvedNull: r.resolvedNull, resolveMs: r.resolveMs })), extraNull: (rs.slice(urls.length) as (string | null)[]).filter((x) => x === null).length, extraTotal: load };
  }
  return NextResponse.json({ region: process.env.VERCEL_REGION, single, underLoad });
}