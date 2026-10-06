// AI 카테고리 판단 프롬프트 시험 — 카테고리가 겹칠 때(후보 여러 개) Gemini가 내용을 보고 고르는지 확인
// 사용: node --experimental-strip-types --no-warnings scripts/curate-v2-ai-test.mts
import fs from "node:fs";
import { generateArticle, buildHintBlock } from "../supabase/functions/curate-v2/lib/ai.ts";

const env: Record<string, string> = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const samples = [
  { name: "AI 박람회 (행사 중심 → MICE 기대)", text: "서울 코엑스에서 열리는 2026 AI 엑스포에 국내외 기업 300여 곳이 참가한다. 주최 측은 전시 부스 1,200개 규모로 바이어 상담회와 컨퍼런스를 함께 운영하며, 해외 바이어 5,000명이 방문할 것으로 예상했다. 전시장 동선과 참가자 등록 방식도 새로 개편했다. 주최 측은 지난해 대비 참가 기업이 25% 늘었고 전시 면적도 확대됐다고 밝혔다. 사전등록은 다음 달 1일부터 시작된다." },
  { name: "AI 업무 자동화 (기술 중심 → AI 기대)", text: "생성형 AI 에이전트를 활용해 반복 업무를 자동화하는 사례가 늘고 있다. 한 기업은 고객 문의 분류와 보고서 작성에 AI 워크플로우를 도입해 업무 시간을 40% 줄였다. 전문가들은 프롬프트 설계와 데이터 연동이 성패를 가른다고 설명한다. 도입 초기에는 오류 검수 체계를 함께 마련해야 하며, 업무별로 에이전트 권한을 분리하는 것이 안전하다는 조언도 나왔다. 비용 대비 효과는 6개월 내 확인되는 경우가 많았다." },
  { name: "외국인 관광객 (관광 중심 → TOURISM 기대)", text: "올해 방한 외국인 관광객이 1,500만 명을 넘어서며 역대 최대치를 기록했다. 체류형 관광 상품과 야간 관광 콘텐츠가 인기를 끌었고, 지역 관광지 방문객도 크게 늘었다. 문화체육관광부는 지방 관광 활성화를 위한 예산을 확대하고 다국어 안내 서비스를 강화하겠다고 밝혔다. 관광 수지는 여전히 적자지만 적자 폭은 줄어드는 추세다. 외국인 소비는 쇼핑에서 체험 중심으로 옮겨가고 있다." },
];
const catSettings = {
  MICE: { audience: "MICE 업계 기획자·운영자", persona: "당신은 MICE 전문 에디터입니다. 전시·컨벤션 업계 실무 관점에서 분석합니다.", keywords: [] },
  TOURISM: { audience: "관광 업계 종사자", persona: "당신은 관광 전문 에디터입니다. 관광 정책·수요 관점에서 분석합니다.", keywords: [] },
  AI: { audience: "업무에 AI를 도입하려는 실무자", persona: "당신은 AI 전문 에디터입니다. 업무 활용 관점에서 분석합니다.", keywords: [] },
};
for (const s of samples) {
  const r = await generateArticle({ apiKey: env.GOOGLE_AI_API_KEY, articleText: s.text, url: "https://example.com/test", categories: ["MICE", "TOURISM", "AI"], catSettings, levelPrompts: {}, hintBlock: buildHintBlock(null) });
  console.log(`\n## ${s.name}`);
  console.log(r.ok ? `   → ${r.value.category} | 근거: ${r.value.category_reason} | 제목: ${r.value.title}` : `   실패: ${r.error}`);
}
