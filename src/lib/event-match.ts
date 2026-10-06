// 행사 매칭·비공개 규칙 — scrape-events Edge Function 의 normalizeKey / noiseReason 과 같은 규칙을 유지할 것
// (엑셀 가져오기도 자동 수집과 같은 기준으로 중복 판정·제외하도록 공유)

export function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]/g, "")
    .replace(/제?\s*\d+\s*(회|차)\b/g, "")
    .replace(/20\d{2}\s*(년도|년)?/g, "")
    .replace(/[\s·,&\-–—_.:!'"~]/g, "");
}

export const looseKey = (name: string) => normalizeKey(name) || name.toLowerCase();

export type KeyRow = { loose: string };
export type DateIndex<T extends KeyRow> = Map<string, T[]>;

export function addToIndex<T extends { start_date: string; event_name: string }>(idx: DateIndex<T & KeyRow>, row: T) {
  const list = idx.get(row.start_date) ?? [];
  list.push({ ...row, loose: looseKey(row.event_name) });
  idx.set(row.start_date, list);
}

// 같은 시작일 + (정규화 이름 동일 | 한쪽이 다른 쪽을 포함, 6자 이상)
export function matchEvent<T extends KeyRow>(idx: DateIndex<T>, name: string, start: string): T | undefined {
  const key = looseKey(name);
  const list = idx.get(start) ?? [];
  return list.find((x) => x.loose === key)
    ?? list.find((x) => Math.min(x.loose.length, key.length) >= 6 && (x.loose.includes(key) || key.includes(x.loose)));
}

export type EventFilterRule = { keyword: string; filter_type: string | null };

// 걸리면 제외 사유, 아니면 null. industry 규칙은 짧은 분야명에만 적용(긴 세부품목 본문엔 걸지 않음)
export function noiseReason(name: string, category: string | null, rules: EventFilterRule[]): string | null {
  const lname = name.toLowerCase();
  for (const r of rules) {
    const type = r.filter_type ?? "name";
    if (type === "name" && lname.includes(r.keyword.toLowerCase())) return `행사명:${r.keyword}`;
    if ((type === "industry" || type === "category") && category && category.includes(r.keyword)) return `${type === "category" ? "분야" : "품목"}:${r.keyword}`;
  }
  return null;
}
