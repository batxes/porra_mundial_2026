"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  SoberaQuizModal,
  type SoberaQuizCompletion,
  soberaQuizCompletedEventName,
} from "@/components/sobera-quiz-modal";
import { useAppContext } from "@/lib/app-context";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type QuizStatusRow = {
  active?: boolean;
  completed?: boolean;
};

type QuizRpcClient = {
  rpc: (
    fn: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? ((data[0] as T | undefined) ?? null) : (data as T);
}

export function SoberaQuizGate() {
  const router = useRouter();
  const { ready, usingSupabase, user } = useAppContext();
  const [open, setOpen] = useState(false);
  const completedRef = useRef(false);

  const checkStatus = useCallback(async () => {
    if (!ready || !usingSupabase || !user || completedRef.current) {
      setOpen(false);
      return;
    }
    const supabase = getSupabaseBrowserClient() as unknown as
      | QuizRpcClient
      | null;
    if (!supabase) return;
    const { data, error } = await supabase.rpc("sobera_quiz_status");
    if (error) return;
    const status = firstRow<QuizStatusRow>(data);
    const shouldOpen = Boolean(status?.active && !status.completed);
    setOpen(shouldOpen);
  }, [ready, usingSupabase, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [checkStatus]);

  useEffect(() => {
    if (!ready || !usingSupabase || !user || completedRef.current) return;
    const interval = window.setInterval(() => {
      void checkStatus();
    }, 30000);
    const onFocus = () => void checkStatus();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [checkStatus, ready, usingSupabase, user]);

  const handleCompleted = useCallback((result: SoberaQuizCompletion) => {
    completedRef.current = true;
    window.dispatchEvent(
      new CustomEvent(soberaQuizCompletedEventName, { detail: result }),
    );
  }, []);

  const closeModal = useCallback(() => {
    setOpen(false);
  }, []);

  const goToPacks = useCallback(() => {
    setOpen(false);
    router.push("/cofres");
  }, [router]);

  if (!open) return null;
  return (
    <SoberaQuizModal
      onClose={closeModal}
      onCompleted={handleCompleted}
      onOpenPacks={goToPacks}
    />
  );
}
