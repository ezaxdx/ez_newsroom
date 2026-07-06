import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * GET /api/admin/newsletter/subscribers/template
 * 수신자 일괄 업로드용 Excel 템플릿 다운로드
 * 컬럼: email (필수), name (선택)
 */
export async function GET() {
  const unauth = await requireAdmin();
  if (unauth) return unauth;

  // xlsx는 서버에서 동적으로 import (번들 사이즈 최적화)
  const XLSX = await import("xlsx");

  const ws = XLSX.utils.aoa_to_sheet([
    // 헤더 행
    ["name", "email"],
    // 예시 데이터 2행
    ["홍길동", "hong@example.com"],
    ["김철수", "kim@example.com"],
  ]);

  // 컬럼 너비 설정
  ws["!cols"] = [{ wch: 20 }, { wch: 30 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "수신자");

  const arr = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as number[];
  const uint8 = new Uint8Array(arr);

  return new Response(uint8.buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="subscribers_template.xlsx"',
    },
  });
}
