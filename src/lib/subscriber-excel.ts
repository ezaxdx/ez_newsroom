// 수신자 엑셀 읽기 — 양식이 정해져 있지 않은 엑셀(사내 연락망 등)에서 이메일과 이름을 찾아낸다.
//  · 모든 시트를 훑고, 열·행 위치와 상관없이 이메일 형태의 셀을 찾음 (시트에 이메일이 없으면 건너뜀 — 예: 내선번호만 있는 전화번호부 시트)
//  · 이름: ① "이름/성명/name" 헤더가 있는 열의 같은 행 값 ② "홍길동 <a@b.com>" 형태의 앞부분 ③ 같은 행에서 이메일 왼쪽(없으면 오른쪽)에 가장 가까운 이름처럼 생긴 셀
//  · 같은 이메일은 하나로 합침 (소문자 기준)
// 기존 템플릿(name, email 열)도 그대로 읽힘.

import type * as XLSXType from "xlsx";

export type ParsedContact = { email: string; name?: string; sheet: string };
export type ParseResult = {
  contacts: ParsedContact[];
  sheets: { name: string; count: number }[];   // 이메일을 찾은 시트별 인원
  skipped: string[];                           // 이메일이 없어 건너뛴 시트
};

const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}/g;
const NAME_HEADER = /^(이름|성명|name|담당자|직원명)$/i;
// 이름처럼 생긴 셀: 한글 2~5자, 또는 영문 이름(공백·점 허용). 숫자·전화번호·이메일·직책 같은 긴 문장은 제외
const looksLikeName = (s: string) => /^[가-힣]{2,5}$/.test(s) || /^[A-Za-z][A-Za-z .'-]{1,30}$/.test(s);

export function extractContacts(XLSX: typeof XLSXType, wb: XLSXType.WorkBook): ParseResult {
  const out = new Map<string, ParsedContact>();
  const sheets: ParseResult["sheets"] = [];
  const skipped: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: false, defval: "" });
    const cell = (r: number, c: number) => String(rows[r]?.[c] ?? "").replace(/\s+/g, " ").trim();

    // 이름 열 헤더 찾기 (앞 15행 안)
    let nameCol = -1;
    for (let r = 0; r < Math.min(rows.length, 15) && nameCol < 0; r++) {
      for (let c = 0; c < (rows[r]?.length ?? 0); c++) if (NAME_HEADER.test(cell(r, c))) { nameCol = c; break; }
    }

    let found = 0;
    for (let r = 0; r < rows.length; r++) {
      const width = rows[r]?.length ?? 0;
      for (let c = 0; c < width; c++) {
        const text = cell(r, c);
        if (!text.includes("@")) continue;
        const emails = text.match(EMAIL_RE);
        if (!emails) continue;

        let name: string | undefined;
        const angle = text.match(/^(.{1,30}?)\s*[<(]/);                         // "홍길동 <a@b.com>"
        if (angle && looksLikeName(angle[1].trim())) name = angle[1].trim();
        if (!name && nameCol >= 0 && nameCol !== c && looksLikeName(cell(r, nameCol))) name = cell(r, nameCol);
        if (!name) {
          for (let k = c - 1; k >= 0 && !name; k--) { const v = cell(r, k); if (v && looksLikeName(v)) name = v; else if (v && /@/.test(v)) break; }
        }
        if (!name) {
          for (let k = c + 1; k < width && !name; k++) { const v = cell(r, k); if (v && looksLikeName(v)) name = v; else if (v && /@/.test(v)) break; }
        }

        for (const raw of emails) {
          const email = raw.toLowerCase();
          if (!out.has(email)) { out.set(email, { email, name, sheet: sheetName }); found++; }
          else if (name && !out.get(email)!.name) out.get(email)!.name = name;
        }
      }
    }
    if (found > 0) sheets.push({ name: sheetName, count: found }); else skipped.push(sheetName);
  }
  return { contacts: [...out.values()], sheets, skipped };
}
