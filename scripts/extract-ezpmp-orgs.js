const fs = require("fs");
const path = require("path");

const text = fs.readFileSync(
  path.join(__dirname, "../docs/Ezpmp 행사 진행 내역_260522.csv"),
  "utf8"
);

const lines = text.split("\n").slice(3); // 헤더 3줄 제거
const orgs = new Set();

for (const line of lines) {
  if (!line.trim()) continue;
  // 간단 CSV 파싱 (따옴표 내 쉼표 무시)
  const cols = [];
  let cur = "", inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === "," && !inQ) { cols.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  cols.push(cur.trim());

  // 발주처(7), 주최기관(10), 주관기관(11)
  [cols[7], cols[10], cols[11]].forEach((v) => {
    if (!v) return;
    // 복수 기관 ","로 구분된 경우 분리
    const parts = v.split(/,|·/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const base = part.replace(/\([^)]*\)/g, "").trim();
      const abbr = (part.match(/\(([^)]+)\)/) || [])[1];
      if (base && base.length > 1) orgs.add(base);
      if (abbr && abbr.length > 1) orgs.add(abbr);
    }
  });
}

const sorted = [...orgs].filter(Boolean).sort();
console.log("총", sorted.length, "개");
console.log(sorted.join("\n"));
