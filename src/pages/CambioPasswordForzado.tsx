import React, { useState } from 'react';
import { AlertCircle, KeyRound, Loader2, LogOut } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../state/auth-context';
import { APP_NAME } from '../config/company';

const control =
  'h-10 w-full text-sm border border-line rounded-lg bg-surface px-3 text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30';

/**
 * Bloqueo de primer inicio: mientras must_change_password sea true la
 * aplicación no muestra el shell, solo este cambio de contraseña.
 */
export const CambioPasswordForzado: React.FC = () => {
  const { user, reload, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);
    if (next.length < 10) {
      setError('La nueva contraseña debe tener al menos 10 caracteres.');
      return;
    }
    if (next !== confirm) {
      setError('Las contraseñas nuevas no coinciden.');
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setDone(true);
      await reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CREDENCIALES_INVALIDAS') {
        setError('La contraseña actual no es correcta.');
      } else {
        setError(e instanceof Error ? e.message : 'No se pudo cambiar la contraseña.');
      }
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-sm bg-surface border border-line rounded-card shadow-card p-6 text-center">
          <p className="text-[13px] font-semibold text-ink">Contraseña actualizada</p>
          <p className="mt-1 text-xs text-ink-muted">Ya puedes continuar con la aplicación.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-4 text-center">
          <p className="text-[13px] font-semibold text-ink">{APP_NAME}</p>
          <p className="text-xs text-ink-muted mt-0.5">Debes cambiar tu contraseña para continuar</p>
        </div>
        <form
          className="bg-surface border border-line rounded-card shadow-card p-6 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {error && (
            <div className="p-2.5 rounded-md bg-danger/5 border border-danger/20 text-danger text-xs leading-relaxed flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <label className="block">
            <span className="block text-[11px] text-ink-muted mb-1">Contraseña actual</span>
            <input
              className={control}
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoFocus
            />
          </label>
          <label className="block">
            <span className="block text-[11px] text-ink-muted mb-1">Nueva contraseña</span>
            <input
              className={control}
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <span className="block text-[11px] text-ink-muted mt-1">Mínimo 10 caracteres.</span>
          </label>
          <label className="block">
            <span className="block text-[11px] text-ink-muted mb-1">Confirmar nueva contraseña</span>
            <input
              className={control}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              className="h-9 inline-flex items-center gap-1.5 px-3 text-xs text-ink-muted hover:text-ink transition-colors"
              onClick={() => void logout()}
            >
              <LogOut className="w-3.5 h-3.5" />
              Salir
            </button>
            <button
              type="submit"
              className="h-9 inline-flex items-center gap-1.5 px-4 text-xs font-medium rounded-lg bg-brand text-white hover:bg-brand-600 transition-colors disabled:opacity-60"
              disabled={busy}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
              Cambiar contraseña
            </button>
          </div>
        </form>
        <p className="mt-3 text-center text-[11px] text-ink-faint">{user?.email}</p>
      </div>
    </div>
  );
};
