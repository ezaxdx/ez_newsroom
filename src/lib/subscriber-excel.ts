// 수신자 엑셀 읽기 — 양식이 정해져 있지 않은 엑셀(사내 연락망 등)에서 이메일과 이름을 찾아낸다.
//  · 모든 시트를 훑고, 열·행 위치와 상관없이 이메일 형태의 셀을 찾음 (시트에 이메일이 없으면 건너뜀 — 예: 내선번호만 있는 전화번호부 시트)
//  · 이름: ① "이름/성명/name" 헤더가 있는 열의 같은 행 값 ② "홍길동 <a@b.com>" 형태의 앞부분 ③ 같은 행에서 이메일 왼쪽(없으면 오른쪽)에 가장 가까운 이름처럼 생긴 셀
//  · 같은 이메일은 하나로 합침 (소문자 기준)
// 기존 템플릿(name, email 열)도 그대로 읽힘.

import type * as XLSXType from "xlsx";

export type ParsedContact = { email: string; name?: string; sheet: string; excluded?: boolean };
export type ParseResult = {
  contacts: ParsedContact[];
  sheets: { name: string; count: number }[];   // 이메일을 찾은 시트별 인원
  skipped: string[];                           // 이메일이 없어 건너뛴 시트
  excluded: ParsedContact[];                   // 직급에 ^ 표시가 있어 제외 대상으로 표시된 인원 (정규직 외 — 인턴·계약직 등)
  noEmail?: string[];                          // 연락망에서 이메일 아이디가 없어 제외된 인원 ("직급/이름")
  duplicates?: string[];                       // 같은 이메일이 두 번 나와 하나로 합친 인원 이름
};

const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}/g;
const NAME_HEADER = /^(이름|성명|name|담당자|직원명)$/i;
// 이름처럼 생긴 셀: 한글 2~5자, 또는 영문 이름(공백·점 허용). 숫자·전화번호·이메일·직책 같은 긴 문장은 제외
const looksLikeName = (s: string) => /^[가-힣]{2,5}$/.test(s) || /^[A-Za-z][A-Za-z .'-]{1,30}$/.test(s);

// 사내 연락망 시트 고정 열: 직급(A·G) / 이름(B·H) / 이메일 아이디(E·K) — 좌우 두 블록
const PB_BLOCKS = [0, 6];
const FALLBACK_DOMAIN = "ezpmp.co.kr";

// 연락망 시트 읽기: 이름·아이디가 있는 행만 사람으로 봄. ^ 직급 → 제외, 아이디 없음("-" 등) → 제외, 같은 아이디 중복 → 1명
function readPhoneBook(XLSX: typeof XLSXType, wb: XLSXType.WorkBook, sheetName: string, domain: string) {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: false, defval: "" });
  const cell = (r: number, c: number) => String(rows[r]?.[c] ?? "").replace(/\s+/g, " ").trim();
  const people: ParsedContact[] = []; const noEmail: string[] = []; const dupNames: string[] = [];
  const seen = new Set<string>(); let blocks = 0;
  for (let r = 0; r < rows.length; r++) for (const o of PB_BLOCKS) {
    const rank = cell(r, o), name = cell(r, o + 1).replace(/\s/g, ""), id = cell(r, o + 4).toLowerCase();
    if (!rank || !/^[가-힣]{2,5}$/.test(name)) continue;
    blocks++;
    const caret = rank.includes("^");
    const email = /@/.test(id) ? id : /^[a-z0-9][a-z0-9._-]*$/.test(id) ? `${id}@${domain}` : "";
    if (!email) { noEmail.push(`${rank}/${name}`); continue; }
    if (seen.has(email)) { dupNames.push(name); continue; }
    seen.add(email);
    people.push({ email, name, sheet: sheetName, excluded: caret || undefined });
  }
  return { people, noEmail, dupNames, blocks };
}

export function extractContacts(XLSX: typeof XLSXType, wb: XLSXType.WorkBook): ParseResult {
  // 연락망 형식(직급·이름·이메일 아이디 고정 열) 시트가 있으면 그 시트를 기준으로 함
  const allText = wb.SheetNames.flatMap((n) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: false, defval: "" }).flat().map(String)).join(" ");
  const domains: Record<string, number> = {};
  for (const m of allText.match(EMAIL_RE) ?? []) { const d = m.split("@")[1].toLowerCase(); domains[d] = (domains[d] ?? 0) + 1; }
  const domain = Object.entries(domains).sort((a, b) => b[1] - a[1])[0]?.[0] ?? FALLBACK_DOMAIN;
  for (const sheetName of wb.SheetNames) {
    const pb = readPhoneBook(XLSX, wb, sheetName, domain);
    if (pb.blocks >= 10 && pb.people.length >= 10) {
      return {
        contacts: pb.people, sheets: [{ name: sheetName, count: pb.people.length }],
        skipped: wb.SheetNames.filter((n) => n !== sheetName),
        excluded: pb.people.filter((c) => c.excluded),
        noEmail: pb.noEmail, duplicates: pb.dupNames,
      };
    }
  }
  const out = new Map<string, ParsedContact>();
  const sheets: ParseResult["sheets"] = [];
  const skipped: string[] = [];
  const excludedIds = new Set<string>();     // ^ 표시 인원의 이메일 아이디 (연락망 시트에서 읽음)
  const excludedNames = new Set<string>();   // 아이디를 못 읽은 행은 이름으로 보조 매칭

  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: false, defval: "" });
    const cell = (r: number, c: number) => String(rows[r]?.[c] ?? "").replace(/\s+/g, " ").trim();

    // 이름 열 헤더 찾기 (앞 15행 안)
    let nameCol = -1;
    for (let r = 0; r < Math.min(rows.length, 15) && nameCol < 0; r++) {
      for (let c = 0; c < (rows[r]?.length ?? 0); c++) if (NAME_HEADER.test(cell(r, c))) { nameCol = c; break; }
    }

    // 직급 칸에 ^ 가 붙은 인원 찾기 — 예: "사 원^", "인 턴^". 같은 행 오른쪽에 [이름, 내선, 휴대폰, 이메일 아이디] 순으로 이어짐
    // (이름·번호 사이에 빈 칸이 끼어도 연속된 칸 묶음 안에서 마지막 영문 아이디를 이메일 아이디로 봄)
    for (let r = 0; r < rows.length; r++) {
      const width = rows[r]?.length ?? 0;
      for (let c = 0; c < width; c++) {
        const t = cell(r, c);
        if (!t.includes("^") || t.includes("@") || t.length > 12) continue;
        let id: string | undefined; const run: string[] = [];
        for (let k = c + 1; k < Math.min(width, c + 7); k++) { const v = cell(r, k); if (!v) break; run.push(v); }
        for (let i = run.length - 1; i >= 0; i--) if (/^[A-Za-z][A-Za-z0-9._-]{1,29}$/.test(run[i])) { id = run[i].toLowerCase(); break; }
        if (id) excludedIds.add(id);
        else if (run[0] && looksLikeName(run[0])) excludedNames.add(run[0]);
      }
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
  const contacts = [...out.values()];
  for (const c of contacts) {
    const id = c.email.split("@")[0];
    if (excludedIds.has(id) || (c.name && excludedNames.has(c.name))) c.excluded = true;
  }
  return { contacts, sheets, skipped, excluded: contacts.filter((c) => c.excluded) };
}
