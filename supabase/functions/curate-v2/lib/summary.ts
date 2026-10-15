// 큐레이션 완료 안내 — 정기·수동 live 실행이 모두 끝났을 때 카테고리별 발행·대기 건수를 디스코드로 알림
// 이어서 실행이 있었으면 첫 회차부터 이번 회차까지 합산 (curation_logs.details.decisions 기준)
import { sendAlert } from "./alert.ts";

const CAT_LABEL: Record<string, string> = { MICE: "MICE", TOURISM: "관광", AI: "AI", EZPMP: "EZPMP" };
const CAT_ORDER = ["MICE", "TOURISM", "AI", "EZPMP"];

type Counts = Record<string, { publish: number; stage: number }>;

function line(counts: Counts, key: "publish" | "stage"): string {
  const cats = [...CAT_ORDER, ...Object.keys(counts).filter((c) => !CAT_ORDER.includes(c))];
  const parts = cats.filter((c) => counts[c]?.[key]).map((c) => `${CAT_LABEL[c] ?? c} ${counts[c][key]}`);
  return parts.length ? parts.join(" · ") : "없음";
}

export async function sendCompletionSummary(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  webhook: string | undefined,
  opts: { chainStartedMs: number; trigger?: string; chain: number; deferred: number; window?: { start: string; end: string } },
): Promise<void> {
  try {
    const since = new Date(opts.chainStartedMs - 60_000).toISOString();
    const { data } = await supabase.from("curation_logs").select("details, failed").eq("run_mode", "live").gte("run_at", since);
    const counts: Counts = {};
    let failed = 0;
    for (const row of data ?? []) {
      if ((row.details?.status ?? "done") !== "done") continue;
      failed += Number(row.failed) || 0;
      for (const d of (row.details?.decisions ?? []) as { decision?: string; category?: string }[]) {
        if (d.decision !== "publish" && d.decision !== "stage") continue;
        const c = String(d.category ?? "기타").toUpperCase();
        (counts[c] ??= { publish: 0, stage: 0 })[d.decision]++;
      }
    }
    const pub = Object.values(counts).reduce((a, c) => a + c.publish, 0);
    const stg = Object.values(counts).reduce((a, c) => a + c.stage, 0);
    const kind = opts.trigger === "manual" ? "수동" : opts.trigger === "cron" ? "자동" : "";
    const win = opts.window
      ? `발행 창 ${new Date(new Date(opts.window.start).getTime() + 9 * 3600000).toISOString().slice(5, 16).replace("T", " ")} ~ ${new Date(new Date(opts.window.end).getTime() + 9 * 3600000).toISOString().slice(5, 16).replace("T", " ")} KST`
      : "";
    const fields = [
      { name: `발행 ${pub}건`, value: line(counts, "publish") },
      { name: `대기 ${stg}건`, value: stg ? `${line(counts, "stage")}\n큐레이션 보드 대기열에서 검토 후 발행하세요.` : "없음" },
    ];
    if (failed > 0) fields.push({ name: "생성 실패", value: `${failed}건` });
    if (opts.deferred > 0) fields.push({ name: "시간 초과로 남은 후보", value: `${opts.deferred}건 (다음 실행 때 다시 후보가 됩니다)` });
    await sendAlert(webhook, {
      title: `${kind ? kind + " " : ""}큐레이션 완료`.trim(),
      description: [win, opts.chain > 0 ? `이어서 ${opts.chain}회 포함` : ""].filter(Boolean).join(" · ") || "큐레이션이 끝났습니다.",
      level: "info",
      fields,
    });
  } catch (e) {
    console.error("[완료 안내 실패]", e); // 안내 실패가 큐레이션에 영향 주지 않음
  }
}
