"use client";

import { useEffect, useState } from "react";
import { Mail, CheckCircle, XCircle, Loader2, ExternalLink } from "lucide-react";
import HelpPanel, { HelpTrigger, Section, Item } from "@/components/admin/HelpPanel";

export default function GmailPage() {
  const [helpOpen, setHelpOpen] = useState(false);
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
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>Gmail 뉴스레터 연동 <HelpTrigger onClick={() => setHelpOpen(true)} /></h1>
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
              마지막 인증: {new Date(updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
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
          <li>위 "Google 계정으로 인증" 클릭 → Gmail 권한 허용 (읽기·발송 권한을 요청하며, 현재는 뉴스레터 발송에만 사용됩니다)</li>
          <li>연동이 끝나면 뉴스레터 관리의 발송 탭에서 이 계정으로 뉴스레터가 발송됩니다</li>
          <li>토큰이 만료되면 이 페이지(또는 뉴스레터 관리 &gt; Gmail 연동 탭)에서 다시 인증하세요</li>
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

      <HelpPanel title="Gmail 연동 가이드" open={helpOpen} onOpenChange={setHelpOpen}>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--on-surface-variant)" }}>
          뉴스레터를 발송하는 Gmail 계정을 연동합니다. 평소에는 뉴스레터 관리의 "Gmail 연동" 탭에서 상태를 확인하고,
          인증이 끊겼을 때 이 페이지로 돌아와 다시 인증합니다. (Gmail 뉴스레터를 큐레이션 소스로 수집하는 기능은 종료되었습니다.)
        </p>

        <Section n={1} title="현재 상태">
          <Item text="연동 여부와 마지막 인증 시각은 위 상태 카드에서 확인합니다." />
        </Section>

        <Section n={2} title="토큰 만료·인증 끊김 시">
          <Item text="뉴스레터 발송이 모두 실패합니다 (Google 인증 오류 invalid_grant)." />
          <Item text="이 페이지의 [다시 인증 (재연동)] 버튼으로 재연동하세요." />
        </Section>

        <Section n={3} title="알아둘 점">
          <Item text="이 페이지는 사이드바 메뉴에 없습니다. 인증이 끝나면 항상 이 페이지로 돌아옵니다." />
          <Item text="Gmail 소스(RSS 수집용)는 더 이상 지원하지 않습니다." />
        </Section>
      </HelpPanel>
    </div>
  );
}
