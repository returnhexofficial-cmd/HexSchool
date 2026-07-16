"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { academicApi, type AcademicSession } from "@/lib/api/academic";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { sessionSelected } from "@/lib/store/academic-session-slice";
import { useAppDispatch, useAppSelector, useAuth } from "@/lib/store/hooks";

const storageKey = (userId: string) => `hs_academic_session:${userId}`;

export interface AcademicSessionSwitcher {
  sessions: AcademicSession[];
  /** The switcher's selection — session-scoped pages read this. */
  selected: AcademicSession | null;
  /** The school's is_current session (activation state, not selection). */
  current: AcademicSession | null;
  isPending: boolean;
  select: (id: string) => void;
}

/**
 * Global session switcher (roadmap M05 §5, a convention from here on):
 * selection is per-user (localStorage), defaults to the school's current
 * session, and lives in Redux so every session-scoped page sees the same
 * value the header switcher shows.
 */
export function useAcademicSession(): AcademicSessionSwitcher {
  const { user, status } = useAuth();
  const { can } = usePermissions();
  const dispatch = useAppDispatch();
  const selectedId = useAppSelector((s) => s.academicSession.selectedId);

  const enabled = status === "authenticated" && can("session.view");
  const sessionsQuery = useQuery({
    queryKey: ["academic-sessions", "switcher"],
    queryFn: () => academicApi.listSessions({ limit: 100, sort: "startDate:desc" }),
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const sessions = useMemo(
    () => sessionsQuery.data?.data ?? [],
    [sessionsQuery.data],
  );
  const current = sessions.find((s) => s.isCurrent) ?? null;

  // Hydrate once per login: stored per-user choice → current session.
  useEffect(() => {
    if (!user || selectedId || sessions.length === 0) return;
    const stored = window.localStorage.getItem(storageKey(user.id));
    const valid = stored && sessions.some((s) => s.id === stored);
    dispatch(sessionSelected(valid ? stored : (current?.id ?? null)));
  }, [user, selectedId, sessions, current, dispatch]);

  const select = useCallback(
    (id: string) => {
      dispatch(sessionSelected(id));
      if (user) window.localStorage.setItem(storageKey(user.id), id);
    },
    [dispatch, user],
  );

  return {
    sessions,
    selected: sessions.find((s) => s.id === selectedId) ?? current,
    current,
    isPending: enabled && sessionsQuery.isPending,
    select,
  };
}
