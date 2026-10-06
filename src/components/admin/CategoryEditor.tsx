"use client";

import { useState } from "react";
import { Loader2, Pencil, X as XIcon } from "lucide-react";
import type { NewsItem } from "@/lib/types";

const OPTIONS = ["MICE", "TOURISM", "AI", "EZPMP"];
const LEVEL_LABEL: Record<string, string> = { Beginner: "입문", Intermediate: "실무", Advanced: "전문" };
const LEVEL_CHOICES = ["keep", "Beginner", "Intermediate", "Advanced"] as const;
type LevelChoice = (typeof LEVEL_CHOICES)[number];

type Rewrite = { title: string; summary_short: string; content_long: string; implications: string };

/** 기사 카테고리 배지 — 눌러서 카테고리를 바꾸고, 필요하면 그 관점으로 글을 다시 쓴다 */
export default function CategoryEditor({ item, onPatch }: { item: NewsItem; onPatch: (patch: Partial<NewsItem>) => void }) {
  const [menu, setMenu] = useState(false);
  const [target, setTarget] = useState<string | null>(null);        // 바꾸려는 카테고리 (선택 창)
  const [busy, setBusy] = useState<"" | "only" | "rewrite" | "replace">("");
  const [draft, setDraft] = useState<Rewrite | null>(null);          // 다시 쓴 안 (비교 창)
  const [err, setErr] = useState("");
  const [lvChoice, setLvChoice] = useState<LevelChoice>("keep");   // 다시 쓸 때의 글 수준 — 기본은 현재 레벨 유지
  const curLevel = item.level ?? "Intermediate";
  const effLevel = lvChoice === "keep" ? curLevel : lvChoice;

  const close = () => { setTarget(null); setDraft(null); setErr(""); setBusy(""); setLvChoice("keep"); };

  const saveOnly = async () => {
    if (!target) return;
    setBusy("only"); setErr("");
    const res = await fetch("/api/admin/news/category", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, category: target }) });
    const json = await res.json();
    if (!res.ok) { setErr(json.error ?? "저장 실패"); setBusy(""); return; }
    onPatch({ category: json.category, category_edited: true, category_reason: null });
    close();
  };
  const makeDraft = async () => {
    if (!target) return;
    setBusy("rewrite"); setErr("");
    const res = await fetch("/api/admin/news/rewrite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, category: target, ...(lvChoice !== "keep" && { level: lvChoice }) }) });
    const json = await res.json();
    setBusy("");
    if (!res.ok) { setErr(json.error ?? "다시 쓰기 실패"); return; }
    setDraft(json as Rewrite);
  };
  const replace = async () => {
    if (!target || !draft) return;
    setBusy("replace"); setErr("");
    const res = await fetch("/api/admin/news/category", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, category: target, ...draft, ...(lvChoice !== "keep" && { level: lvChoice }) }) });
    const json = await res.json();
    if (!res.ok) { setErr(json.error ?? "교체 실패"); setBusy(""); return; }
    onPatch({ category: json.category, category_edited: true, category_reason: null, ...draft, ...(lvChoice !== "keep" && { level: lvChoice }), audited_at: null, faithfulness_score: null, faithfulness_issues: null });
    close();
  };

  const tip = item.category_reason ? `AI 판단 근거: ${item.category_reason}\n(클릭해서 카테고리 변경)` : "클릭해서 카테고리 변경";
  return (
    <span className="relative inline-block">
      <button
        type="button" title={tip} onClick={() => setMenu((o) => !o)}
        className="px-2 py-0.5 rounded-full text-[0.62rem] font-bold tracking-wide uppercase flex items-center gap-1"
        style={{ background: "var(--surface-container-highest)", color: "var(--on-surface-variant)", border: "none", cursor: "pointer" }}
      >
        {item.category}
        {item.category_edited && <Pencil size={8} aria-label="관리자가 수정함" />}
      </button>
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
          <div className="absolute left-0 top-full mt-1 z-50 rounded-lg py-1 min-w-[120px]" style={{ background: "var(--surface-container-lowest)", boxShadow: "0 4px 16px rgba(26,28,29,0.16)", border: "1px solid var(--surface-container-highest)" }}>
            {OPTIONS.map((c) => (
              <button
                key={c} type="button" disabled={c === item.category}
                onClick={() => { setMenu(false); setTarget(c); }}
                className="w-full text-left px-3 py-1.5 text-xs font-semibold flex items-center justify-between gap-3"
                style={{ background: "none", border: "none", cursor: c === item.category ? "default" : "pointer", color: c === item.category ? "var(--on-surface-variant)" : "var(--on-surface)" }}
              >
                {c}{c === item.category && <span className="text-[0.6rem] font-normal">현재</span>}
              </button>
            ))}
          </div>
        </>
      )}

      {target && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8" style={{ background: "rgba(26,28,29,0.45)", cursor: "default" }} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) close(); }}>
          <div className="w-full rounded-xl p-5 flex flex-col gap-4" style={{ maxWidth: draft ? 960 : 520, background: "var(--surface-container-lowest)", boxShadow: "0 8px 32px rgba(26,28,29,0.18)", textTransform: "none", letterSpacing: "normal", fontWeight: 400 }}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold m-0">카테고리 변경 · {item.category} → {target}</h3>
              <button onClick={() => !busy && close()} aria-label="닫기" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--on-surface-variant)" }}><XIcon size={18} /></button>
            </div>
            <p className="text-sm m-0" style={{ color: "var(--on-surface)" }}>{item.title}</p>

            {!draft ? (
              <>
                <p className="text-xs m-0" style={{ color: "var(--on-surface-variant)", lineHeight: 1.6 }}>
                  카테고리마다 글의 관점과 독자가 달라요. 분류만 잘못됐고 글은 그대로 써도 되면 <b>카테고리만 변경</b>, 글도 {target} 관점으로 새로 쓰려면 <b>다시 쓰기</b>를 누르세요. 다시 쓴 글은 지금 글과 나란히 비교한 뒤 교체할 수 있어요.
                </p>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[0.7rem] font-semibold" style={{ color: "var(--on-surface-variant)" }}>다시 쓸 글의 수준 <span className="font-normal">(카테고리만 변경할 때는 적용되지 않아요)</span></span>
                  <div className="flex gap-1.5">
                    {LEVEL_CHOICES.map((c) => {
                      const on = lvChoice === c;
                      return (
                        <button key={c} type="button" onClick={() => setLvChoice(c)} className="flex-1 h-8 rounded-md text-xs font-semibold"
                          style={{ background: on ? "var(--primary)" : "var(--surface-container-low)", color: on ? "#fff" : "var(--on-surface-variant)", border: "none", cursor: "pointer" }}>
                          {c === "keep" ? `유지 (${LEVEL_LABEL[curLevel] ?? curLevel})` : LEVEL_LABEL[c]}
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-[0.68rem]" style={{ color: "var(--on-surface-variant)", lineHeight: 1.5 }}>카테고리가 바뀌면 독자층도 달라질 수 있어요. 바꾸지 않으면 지금 레벨({LEVEL_LABEL[curLevel] ?? curLevel})로 씁니다.</span>
                </div>
                {err && <p className="text-xs m-0" style={{ color: "#b91c1c" }}>{err}</p>}
                <div className="flex justify-end gap-2 flex-wrap">
                  <button onClick={close} disabled={!!busy} className="h-9 px-4 rounded-md text-sm font-medium" style={{ background: "var(--surface-container-highest)", color: "var(--on-surface)", border: "none", cursor: "pointer" }}>취소</button>
                  <button onClick={saveOnly} disabled={!!busy} className="h-9 px-4 rounded-md text-sm font-semibold flex items-center gap-2 disabled:opacity-50" style={{ background: "var(--surface-container-highest)", color: "var(--on-surface)", border: "none", cursor: "pointer" }}>
                    {busy === "only" && <Loader2 size={13} className="animate-spin" />}카테고리만 변경
                  </button>
                  <button onClick={makeDraft} disabled={!!busy} className="h-9 px-4 rounded-md text-sm font-semibold flex items-center gap-2 disabled:opacity-50" style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}>
                    {busy === "rewrite" && <Loader2 size={13} className="animate-spin" />}{target} 관점으로 다시 쓰기
                  </button>
                </div>
                {busy === "rewrite" && <p className="text-xs m-0" style={{ color: "var(--on-surface-variant)" }}>AI가 새로 쓰는 중이에요… (10~20초)</p>}
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {([["지금 글 · " + item.category, { title: item.title, summary_short: item.summary_short, content_long: item.content_long, implications: item.implications }], ["새 글 · " + target, draft]] as [string, Rewrite][]).map(([label, v], i) => (
                    <div key={label} className="rounded-lg p-3 flex flex-col gap-2" style={{ background: i ? "var(--bg-accent, #eef4ff)" : "var(--surface-container-low)" }}>
                      <span className="text-[0.7rem] font-bold" style={{ color: "var(--on-surface-variant)" }}>{label}</span>
                      {([["제목", v.title], ["요약", v.summary_short], ["상세", v.content_long], ["시사점", v.implications]] as [string, string][]).map(([k, t]) => (
                        <div key={k}>
                          <p className="text-[0.65rem] font-semibold m-0" style={{ color: "var(--on-surface-variant)" }}>{k}</p>
                          <p className="text-xs m-0 mt-0.5" style={{ lineHeight: 1.6, color: "var(--on-surface)" }}>{t || "-"}</p>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <p className="text-xs m-0" style={{ color: "var(--on-surface-variant)" }}>[교체]하면 지금 글이 새 글로 바뀌고(글 수준: <b>{LEVEL_LABEL[effLevel] ?? effLevel}</b>), 품질 감사를 다시 받아요. 마음에 안 들면 [취소]하세요 (아무것도 바뀌지 않아요).</p>
                {err && <p className="text-xs m-0" style={{ color: "#b91c1c" }}>{err}</p>}
                <div className="flex justify-end gap-2">
                  <button onClick={close} disabled={!!busy} className="h-9 px-4 rounded-md text-sm font-medium" style={{ background: "var(--surface-container-highest)", color: "var(--on-surface)", border: "none", cursor: "pointer" }}>취소</button>
                  <button onClick={replace} disabled={!!busy} className="h-9 px-4 rounded-md text-sm font-semibold flex items-center gap-2 disabled:opacity-50" style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}>
                    {busy === "replace" && <Loader2 size={13} className="animate-spin" />}교체
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
