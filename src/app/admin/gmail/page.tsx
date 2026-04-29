"use client";

import { useEffect, useState } from "react";
import { Mail, CheckCircle, XCircle, Loader2, ExternalLink } from "lucide-react";

export default function GmailPage() {
  const [status, setStatus] = useState<"loading" | "connected" | "disconnected">("loading");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true") {
      window.history.replaceState({}, "", "/admin/gmail");
    }
    checkStatus();
  }, []);

  async function checkStatus() {
    try {
      const res = await fetch("/api/gmail/status");
      const data = await res.json();
      setStatus(data.connected ? "connected" : "disconnected");
      setUpdatedAt(data.updated_at ?? null);
    } catch {
      setStatus("disconnected");
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: "60px auto", padding: "0 24px", fontFamily: "var(--font-sans, sans-serif)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
        <Mail size={24} />
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Gmail 뉴스레터 연동</h1>
      </div>

      {/* 상태 카드 */}
      <div style={{
        border: "1px solid var(--outline-variant, #e0e0e0)",
        borderRadius: 12,
        padding: "24px",
        marginBottom: 24,
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}>
        {status === "loading" && <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />}
        {status === "connected" && <CheckCircle size={20} color="#2e7d32" />}
        {status === "disconnected" && <XCircle size={20} color="#c62828" />}
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {status === "loading" && "확인 중..."}
            {status === "connected" && "Gmail 연동됨"}
            {status === "disconnected" && "연동 안 됨"}
          </div>
          {updatedAt && (
            <div style={{ fontSize: 13, color: "var(--on-surface-variant, #666)" }}>
              마지막 인증: {new Date(updatedAt).toLocaleString("ko-KR")}
            </div>
          )}
        </div>
      </div>

      {/* 연동 버튼 */}
      <a href="/api/gmail/auth" style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 24px",
        background: status === "connected" ? "var(--surface-container, #f5f5f5)" : "var(--on-surface, #1a1a1a)",
        color: status === "connected" ? "var(--on-surface, #1a1a1a)" : "var(--surface, #fff)",
        borderRadius: 8,
        fontSize: 14,
        fontWeight: 500,
        textDecoration: "none",
        marginBottom: 32,
      }}>
        <ExternalLink size={16} />
        {status === "connected" ? "다시 인증 (재연동)" : "Google 계정으로 인증"}
      </a>

      {/* 사용 방법 */}
      <div style={{
        background: "var(--surface-container-low, #fafafa)",
        borderRadius: 12,
        padding: "20px 24px",
        fontSize: 14,
        lineHeight: 1.7,
        color: "var(--on-surface-variant, #555)",
      }}>
        <div style={{ fontWeight: 600, marginBottom: 12, color: "var(--on-surface, #111)" }}>설정 방법</div>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>아래 전제조건을 먼저 완료하세요.</li>
          <li>위 "Google 계정으로 인증" 클릭 → Gmail 읽기 권한 허용</li>
          <li>연동 완료 후 <strong>/admin/rss</strong> 에서 Gmail 소스 추가</li>
          <li>큐레이션 실행 시 자동으로 뉴스레터 수집</li>
        </ol>

        <div style={{ marginTop: 20, fontWeight: 600, color: "var(--on-surface, #111)" }}>전제조건 (1회)</div>
        <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
          <li><a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer" style={{ color: "inherit" }}>Google Cloud Console</a> → 프로젝트 생성</li>
          <li>Gmail API 활성화</li>
          <li>OAuth 2.0 클라이언트 ID 생성 (웹 애플리케이션 유형)</li>
          <li>승인된 리디렉션 URI: <code style={{ background: "#eee", padding: "1px 6px", borderRadius: 4 }}>http://localhost:3000/api/gmail/callback</code></li>
          <li><code style={{ background: "#eee", padding: "1px 6px", borderRadius: 4 }}>.env.local</code>에 <code style={{ background: "#eee", padding: "1px 6px", borderRadius: 4 }}>GMAIL_CLIENT_ID</code>, <code style={{ background: "#eee", padding: "1px 6px", borderRadius: 4 }}>GMAIL_CLIENT_SECRET</code> 입력</li>
        </ol>
      </div>
    </div>
  );
}
