import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  setUnauthorizedHandler,
  type AuthCompany,
  type AuthUser,
} from '../api/client';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Empresas con membresía activa, con roles y permisos de cada una. */
  companies: AuthCompany[];
  /** true si el servidor no respondió (red caída) durante el arranque. */
  serverUnreachable: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Relee /api/me (p. ej. tras cambiar membresías en Fase 3). */
  reload: () => Promise<void>;
  /** Permisos del usuario en una empresa concreta ([] si no hay acceso). */
  permissionsFor: (companyId: string | null | undefined) => string[];
  hasPermission: (code: string, companyId: string | null | undefined) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [companies, setCompanies] = useState<AuthCompany[]>([]);
  const [serverUnreachable, setServerUnreachable] = useState(false);

  const applyMe = useCallback((me: { user: AuthUser; companies: AuthCompany[] }) => {
    setUser(me.user);
    setCompanies(me.companies ?? []);
    setServerUnreachable(false);
    setStatus('authenticated');
  }, []);

  const clear = useCallback(() => {
    setUser(null);
    setCompanies([]);
    setStatus('anonymous');
  }, []);

  const reload = useCallback(async () => {
    const me = await api.getMe();
    applyMe(me);
  }, [applyMe]);

  useEffect(() => {
    // 401 que el refresh no recupera ⇒ a la pantalla de login.
    setUnauthorizedHandler(() => clear());
    let cancelled = false;
    void (async () => {
      try {
        const me = await api.getMe();
        if (!cancelled) applyMe(me);
      } catch (err) {
        if (cancelled) return;
        setServerUnreachable(err instanceof ApiError && err.status === 0);
        clear();
      }
    })();
    return () => {
      cancelled = true;
      setUnauthorizedHandler(null);
    };
  }, [applyMe, clear]);

  const login = useCallback(async (email: string, password: string) => {
    await api.login(email, password);
    const me = await api.getMe();
    applyMe(me);
  }, [applyMe]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      clear();
    }
  }, [clear]);

  const permissionsFor = useCallback(
    (companyId: string | null | undefined): string[] => {
      if (!companyId) return [];
      return companies.find((c) => c.id === companyId)?.permissions ?? [];
    },
    [companies],
  );

  const hasPermission = useCallback(
    (code: string, companyId: string | null | undefined): boolean =>
      permissionsFor(companyId).includes(code),
    [permissionsFor],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      companies,
      serverUnreachable,
      login,
      logout,
      reload,
      permissionsFor,
      hasPermission,
    }),
    [status, user, companies, serverUnreachable, login, logout, reload, permissionsFor, hasPermission],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
