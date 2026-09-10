"use client";

import { useState, useCallback, useEffect } from "react";

/**
 * 페이지 내 탭/필터 상태를 URL 쿼리스트링에 저장 — 새로고침해도 유지됨.
 * useState와 동일한 [value, setValue] 형태라 기존 코드 교체가 간단함.
 * next/navigation의 useSearchParams 대신 순수 브라우저 API(history.replaceState)를
 * 사용 — Suspense 경계 요구사항 없이 아무 클라이언트 컴포넌트에서나 바로 쓸 수 있고,
 * 실제 페이지 이동(라우팅)을 일으키지 않아 불필요한 리렌더/리페치가 없음.
 * 값이 기본값과 같으면 쿼리스트링에서 지워서 URL을 깔끔하게 유지함.
 */
export function useTabParam<T extends string>(key: string, defaultValue: T): [T, (v: T) => void] {
  const [value, setValueState] = useState<T>(defaultValue);

  // 마운트 시 URL에 저장된 값이 있으면 복원 (서버 렌더와의 hydration mismatch를
  // 피하기 위해 초기 렌더는 항상 기본값 → useEffect에서 클라이언트 전용으로 복원)
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get(key);
    if (v) setValueState(v as T);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setValue = useCallback((v: T) => {
    setValueState(v);
    const params = new URLSearchParams(window.location.search);
    if (v === defaultValue) params.delete(key);
    else params.set(key, v);
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [key, defaultValue]);

  return [value, setValue];
}
