"use client";

import { useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, Loader2, Eye, EyeOff } from "lucide-react";
import { Suspense } from "react";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") ?? "/admin";

  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "비밀번호가 올바르지 않습니다");
        setPassword("");
        inputRef.current?.focus();
        return;
      }
      router.push(from);
      router.refresh();
    } catch {
      setError("오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-[0.7rem] font-semibold uppercase tracking-wide"
          style={{ color: "var(--on-surface-variant)" }}>
          비밀번호
        </label>
        <div className="relative">
          <input
            ref={inputRef}
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="관리자 비밀번호 입력"
            autoFocus
            className="w-full h-10 pl-3 pr-10 rounded-lg text-sm outline-none"
            style={{
              background: "var(--surface-container-low)",
              border: `1.5px solid ${error ? "#dc2626" : "transparent"}`,
              color: "var(--on-surface)",
              transition: "border-color 0.15s",
            }}
            onFocus={(e) => {
              if (!error) e.currentTarget.style.borderColor = "var(--primary)";
            }}
            onBlur={(e) => {
              if (!error) e.currentTarget.style.borderColor = "transparent";
            }}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2"
            style={{ background: "transparent", border: "none", cursor: "pointer", display: "flex" }}
          >
            {show
              ? <EyeOff size={15} style={{ color: "var(--on-surface-variant)" }} />
              : <Eye size={15} style={{ color: "var(--on-surface-variant)" }} />}
          </button>
        </div>
        {error && (
          <p className="text-xs" style={{ color: "#dc2626" }}>{error}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={loading || !password}
        className="h-10 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-40 flex items-center justify-center gap-2"
        style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}
      >
        {loading ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
        {loading ? "확인 중..." : "로그인"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--surface-container-low)" }}
    >
      <div
        className="w-full max-w-sm p-8 rounded-2xl flex flex-col gap-6"
        style={{ background: "var(--surface-container-lowest)", boxShadow: "0 4px 24px rgba(26,28,29,0.08)" }}
      >
        {/* Header */}
        <div className="flex flex-col gap-1">
          <p className="text-[0.65rem] font-semibold tracking-[0.08em] uppercase m-0"
            style={{ color: "var(--on-surface-variant)" }}>
            Editorial Control
          </p>
          <h1 className="text-xl font-bold tracking-tight m-0">The Monolith</h1>
          <p className="text-sm m-0 mt-1" style={{ color: "var(--on-surface-variant)" }}>
            관리자 페이지에 접근하려면 비밀번호를 입력하세요
          </p>
        </div>

        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
