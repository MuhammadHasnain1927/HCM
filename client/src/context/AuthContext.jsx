import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({
    loading: true,
    bootError: null,
    setupDone: false,
    user: null,
    company: null,
  });

  const applySession = useCallback(({ token, user, company }) => {
    if (token) tokenStore.set(token);
    setState((s) => ({ ...s, setupDone: true, user, company: company ?? s.company }));
  }, []);

  const boot = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, bootError: null }));
    try {
      // Both requests run in parallel; /auth/me only when a token is stored.
      const mePromise = tokenStore.get() ? api.get('/auth/me').catch(() => null) : Promise.resolve(null);
      const [{ data: status }, meRes] = await Promise.all([api.get('/setup/status'), mePromise]);
      let user = null;
      let company = status.companyName ? { name: status.companyName } : null;
      if (status.setupDone && meRes) {
        user = meRes.data.user;
        company = meRes.data.company ?? company;
      } else if (tokenStore.get()) {
        tokenStore.clear();
      }
      setState({ loading: false, bootError: null, setupDone: status.setupDone, user, company });
    } catch {
      setState((s) => ({ ...s, loading: false, bootError: 'Cannot reach the server. Please try again.' }));
    }
  }, []);

  useEffect(() => {
    boot();
  }, [boot]);

  // Reacts to session problems reported by the API client.
  useEffect(() => {
    const onExpired = () => setState((s) => ({ ...s, user: null }));
    const onRefresh = async () => {
      try {
        const { data } = await api.get('/auth/me');
        setState((s) => ({ ...s, user: data.user }));
      } catch {
        tokenStore.clear();
        setState((s) => ({ ...s, user: null }));
      }
    };
    window.addEventListener('auth:expired', onExpired);
    window.addEventListener('auth:refresh', onRefresh);
    return () => {
      window.removeEventListener('auth:expired', onExpired);
      window.removeEventListener('auth:refresh', onRefresh);
    };
  }, []);

  const login = useCallback(
    async (email, password) => {
      const { data } = await api.post('/auth/login', { email, password });
      applySession(data);
      return data.user;
    },
    [applySession],
  );

  const completeSetup = useCallback(
    async (payload) => {
      const { data } = await api.post('/setup', payload);
      applySession(data);
      return data.user;
    },
    [applySession],
  );

  const changePassword = useCallback(
    async (currentPassword, newPassword) => {
      const { data } = await api.post('/auth/change-password', { currentPassword, newPassword });
      applySession(data);
      return data.user;
    },
    [applySession],
  );

  const logout = useCallback(() => {
    tokenStore.clear();
    setState((s) => ({ ...s, user: null }));
  }, []);

  const value = useMemo(
    () => ({ ...state, login, logout, completeSetup, changePassword, retry: boot }),
    [state, login, logout, completeSetup, changePassword, boot],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
