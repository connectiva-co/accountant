import React, { useState } from 'react';
import { LogIn, Loader2, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { ApiError } from '../api/client';
import { useAuth } from '../state/auth-context';
import { APP_NAME } from '../config/company';
import { AccountantLogo } from '../components/common/Logo';

const control =
  'h-10 w-full text-sm border border-line rounded-lg bg-surface pl-9 pr-3 text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all';

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'El servidor de Accountant no está disponible.';
    switch (err.code) {
      case 'CREDENCIALES_INVALIDAS':
        return 'Correo o contraseña incorrectos.';
      case 'CUENTA_INACTIVA':
        return 'La cuenta está deshabilitada. Contacta al administrador.';
      case 'CUENTA_BLOQUEADA':
        return 'Cuenta bloqueada por demasiados intentos. Vuelve a intentarlo en unos minutos.';
      case 'CSRF_INVALIDO':
        return 'La sesión expiró. Recarga la página e inténtalo de nuevo.';
      default:
        return err.message || 'No se pudo iniciar sesión.';
    }
  }
  return 'No se pudo iniciar sesión.';
}

export const LoginPage: React.FC = () => {
  const { login, serverUnreachable } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-surface">
      {/* Visual Brand Panel (Split Left) */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-[#061C16] overflow-hidden items-center justify-center p-12 select-none">
        {/* Subtle Ambient Radial Lighting */}
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-brand-500/20 rounded-full blur-3xl pointer-events-none" />

        {/* Minimal Grid Texture Overlay */}
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle, #ffffff 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }}
        />

        {/* Centered High-End Brand Emblem & Wordmark (Zero decorative fluff) */}
        <div className="relative z-10 flex flex-col items-center gap-6">
          <div className="relative">
            <div className="absolute inset-0 bg-emerald-400/20 rounded-3xl blur-2xl transform scale-125" />
            <AccountantLogo size="xl" showText={false} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-white font-sans">
              {APP_NAME}
            </span>
          </div>
        </div>
      </div>

      {/* Login Form Panel (Split Right) */}
      <div className="flex-1 flex flex-col justify-center items-center px-6 sm:px-12 lg:px-16 py-12 bg-canvas lg:bg-surface">
        <div className="w-full max-w-sm space-y-6">
          {/* Brand header on mobile screens */}
          <div className="lg:hidden flex items-center justify-center mb-4">
            <AccountantLogo size="lg" />
          </div>

          <div>
            <h1 className="text-xl font-bold text-ink tracking-tight">Iniciar sesión</h1>
            <p className="text-xs text-ink-muted mt-1">
              Accede con tus credenciales asignadas.
            </p>
          </div>

          <form className="space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="block text-[11.5px] font-medium text-ink mb-1.5">
                Correo electrónico
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-ink-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  className={control}
                  value={email}
                  autoComplete="email"
                  required
                  placeholder="usuario@empresa.com"
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-[11.5px] font-medium text-ink mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-ink-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  className={`${control} pr-10`}
                  value={password}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••••"
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink transition-colors p-0.5"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div
                className="text-xs text-danger bg-danger/5 border border-danger/20 rounded-lg px-3.5 py-2.5 leading-relaxed"
                role="alert"
              >
                {error}
              </div>
            )}

            {serverUnreachable && !error && (
              <div className="text-xs text-ink-muted bg-canvas border border-line rounded-lg px-3.5 py-2.5">
                El servidor no responde. Revisa que el backend esté ejecutándose en el puerto 3001.
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full h-10 inline-flex items-center justify-center gap-2 text-sm font-semibold rounded-lg bg-brand text-white hover:bg-brand-600 active:scale-[0.99] shadow-sm transition-all disabled:opacity-60 cursor-pointer"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              <span>Ingresar</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
