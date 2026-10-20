import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Ban,
  Building2,
  Check,
  Copy,
  KeyRound,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  Shield,
  User,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../state/app-context';
import { useAuth } from '../state/auth-context';
import {
  api,
  type AdminCompanyRow,
  type AdminUserDetail,
  type AdminUserSummary,
  type PermissionRow,
  type RoleRow,
  type SessionRow,
  type UserCompanyRow,
} from '../api/client';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';

/* ------------------------------------------------------------------ */
/* Estilos compartidos                                                 */
/* ------------------------------------------------------------------ */

const control =
  'h-8 w-full text-xs border border-line rounded-md bg-surface px-2.5 text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30';
const btn =
  'h-8 inline-flex items-center gap-1.5 px-3 text-xs border border-line rounded-md bg-surface text-ink hover:bg-canvas transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const btnPrimary =
  'h-8 inline-flex items-center gap-1.5 px-3 text-xs font-medium rounded-md bg-brand text-white hover:bg-brand-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const btnDanger =
  'h-8 inline-flex items-center gap-1.5 px-3 text-xs border border-danger/30 rounded-md bg-surface text-danger hover:bg-danger/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const th = 'px-3 py-2 text-left text-[11px] font-medium text-ink-muted uppercase tracking-wide';
const td = 'px-3 py-2 text-[12px] text-ink align-top';

const PILL: Record<string, string> = {
  ok: 'bg-success/10 text-success border-success/20',
  warn: 'bg-warning/10 text-warning border-warning/20',
  muted: 'bg-gray-100 text-ink-muted border-gray-200',
  bad: 'bg-danger/10 text-danger border-danger/20',
};

const Pill: React.FC<{ kind?: 'ok' | 'warn' | 'muted' | 'bad'; children: React.ReactNode }> = ({
  kind = 'muted',
  children,
}) => (
  <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap ${PILL[kind]}`}>
    {children}
  </span>
);

const Chip: React.FC<{ children: React.ReactNode; onRemove?: () => void; disabled?: boolean }> = ({
  children,
  onRemove,
  disabled,
}) => (
  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-line bg-canvas text-[11px] font-medium text-ink">
    {children}
    {onRemove && (
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label="Quitar rol"
        className="text-ink-faint hover:text-danger transition-colors disabled:opacity-40"
      >
        <X className="w-3 h-3" />
      </button>
    )}
  </span>
);

const ErrorBox: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <div className="mb-3 p-3 rounded-md bg-danger/5 border border-danger/20 text-danger text-xs leading-relaxed flex items-start gap-2">
      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  ) : null;

const LoadingRow: React.FC<{ label?: string }> = ({ label = 'Cargando…' }) => (
  <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-ink-muted">
    <Loader2 className="w-3.5 h-3.5 animate-spin" />
    {label}
  </div>
);

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function errMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/* ------------------------------------------------------------------ */
/* Modales auxiliares                                                  */
/* ------------------------------------------------------------------ */

const SecretModal: React.FC<{ title: string; secret: string; onClose: () => void }> = ({ title, secret, onClose }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* portapapeles no disponible */
    }
  };
  return (
    <Modal
      title={title}
      subtitle="Guárdala ahora: no volverá a mostrarse."
      onClose={onClose}
      footer={
        <button type="button" className={btnPrimary} onClick={onClose}>
          Entendido
        </button>
      }
    >
      <div className="flex items-center gap-2">
        <code className="flex-1 px-3 py-2 rounded-md border border-line bg-canvas text-[13px] num select-all break-all">
          {secret}
        </code>
        <button type="button" className={btn} onClick={() => void copy()}>
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <p className="mt-3 text-[11px] text-ink-muted">
        La persona deberá cambiarla en su primer inicio de sesión. Las sesiones abiertas se cerraron.
      </p>
    </Modal>
  );
};

const ConfirmModal: React.FC<{
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}> = ({ title, message, confirmLabel = 'Confirmar', danger, busy, error, onConfirm, onClose }) => (
  <Modal
    title={title}
    onClose={onClose}
    busy={busy}
    footer={
      <>
        <button type="button" className={btn} onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button type="button" className={danger ? btnDanger : btnPrimary} onClick={onConfirm} disabled={busy}>
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {confirmLabel}
        </button>
      </>
    }
  >
    <ErrorBox message={error ?? null} />
    <p className="text-[13px] text-ink leading-relaxed">{message}</p>
  </Modal>
);

const SessionsModal: React.FC<{
  target: { id: string; full_name: string; email: string };
  companyId: string;
  canRevoke: boolean;
  onChanged?: () => void;
  onClose: () => void;
}> = ({ target, companyId, canRevoke, onChanged, onClose }) => {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.listSessions(target.id, companyId);
      setSessions(r.sessions);
    } catch (e) {
      setError(errMessage(e, 'No se pudieron cargar las sesiones.'));
      setSessions((prev) => prev ?? []);
    }
  }, [target.id, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (sessionId?: string) => {
    setBusy(true);
    setError(null);
    try {
      if (sessionId) await api.revokeSession(target.id, sessionId, companyId);
      else await api.revokeAllSessions(target.id, companyId);
      await load();
      onChanged?.();
    } catch (e) {
      setError(errMessage(e, 'No se pudo cerrar la sesión.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Sesiones · ${target.full_name}`}
      subtitle={target.email}
      onClose={onClose}
      busy={busy}
      className="max-w-3xl"
      footer={
        <>
          <button type="button" className={btn} onClick={onClose} disabled={busy}>
            Cerrar
          </button>
          {canRevoke && (
            <button type="button" className={btnDanger} onClick={() => void revoke()} disabled={busy || !sessions?.length}>
              <LogOut className="w-3.5 h-3.5" />
              Cerrar todas
            </button>
          )}
        </>
      }
    >
      <ErrorBox message={error} />
      {sessions === null && <LoadingRow label="Consultando sesiones…" />}
      {sessions !== null && sessions.length === 0 && (
        <p className="text-[12px] text-ink-muted">No hay sesiones activas.</p>
      )}
      {sessions !== null && sessions.length > 0 && (
        <div className="overflow-x-auto border border-line rounded-md">
          <table className="w-full">
            <thead className="bg-canvas border-b border-line">
              <tr>
                <th className={th}>IP</th>
                <th className={th}>Dispositivo</th>
                <th className={th}>Creada</th>
                <th className={th}>Último uso</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td className={`${td} num`}>{s.ip ?? '—'}</td>
                  <td className={td} title={s.user_agent ?? undefined}>
                    {s.user_agent ? (s.user_agent.length > 48 ? `${s.user_agent.slice(0, 48)}…` : s.user_agent) : '—'}
                  </td>
                  <td className={`${td} num`}>{fmtDate(s.created_at)}</td>
                  <td className={`${td} num`}>{fmtDate(s.last_used_at)}</td>
                  <td className={`${td} text-right`}>
                    {canRevoke && (
                      <button
                        type="button"
                        className={btn}
                        disabled={busy}
                        onClick={() => void revoke(s.id)}
                      >
                        Cerrar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
};

/* ------------------------------------------------------------------ */
/* Pestaña: Usuarios                                                   */
/* ------------------------------------------------------------------ */

interface TabProps {
  companyId: string;
  can: (code: string) => boolean;
  onChanged: (targetUserId?: string) => void;
  onSecret: (title: string, secret: string) => void;
}

const CreateUserModal: React.FC<{
  companyId: string;
  onClose: () => void;
  onCreated: (temporary: string | null) => void;
}> = ({ companyId, onClose, onCreated }) => {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !fullName.trim()) {
      setError('El correo y el nombre son obligatorios.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.createUser(companyId, {
        email: email.trim(),
        full_name: fullName.trim(),
        ...(password ? { password } : {}),
      });
      onCreated(r.temporary_password);
    } catch (e) {
      setError(errMessage(e, 'No se pudo crear el usuario.'));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Agregar usuario"
      subtitle="Se creará con acceso a la empresa activa"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className={btnPrimary} onClick={() => void submit()} disabled={busy}>
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <UserPlus className="w-3.5 h-3.5" />
            Crear usuario
          </button>
        </>
      }
    >
      <ErrorBox message={error} />
      <div className="space-y-3">
        <label className="block">
          <span className="block text-[11px] text-ink-muted mb-1">Nombre completo</span>
          <input className={control} value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
        </label>
        <label className="block">
          <span className="block text-[11px] text-ink-muted mb-1">Correo</span>
          <input
            className={control}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nombre@empresa.com"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] text-ink-muted mb-1">Contraseña (opcional)</span>
          <input
            className={control}
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Vacío: se genera una contraseña temporal"
            autoComplete="new-password"
          />
          <span className="block text-[11px] text-ink-muted mt-1">
            Mínimo 10 caracteres. Si se genera una temporal, se mostrará una sola vez al finalizar.
          </span>
        </label>
      </div>
    </Modal>
  );
};

const UserDetailModal: React.FC<{
  userId: string;
  companyId: string;
  companyLabel: string;
  can: (code: string) => boolean;
  isSelf: boolean;
  onChanged: (targetUserId?: string) => void;
  onSecret: (title: string, secret: string) => void;
  onClose: () => void;
}> = ({ userId, companyId, companyLabel, can, isSelf, onChanged, onSecret, onClose }) => {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [userCompanies, setUserCompanies] = useState<UserCompanyRow[] | null>(null);
  const [adminCos, setAdminCos] = useState<AdminCompanyRow[] | null>(null);
  const [rolesByCompany, setRolesByCompany] = useState<Record<string, RoleRow[]>>({});
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [modalTab, setModalTab] = useState<'empresas' | 'cuenta' | 'sesiones'>('empresas');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'reset' | 'disable' | 'reactivate' | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, cs, ac] = await Promise.all([
        api.getUser(userId, companyId),
        api.listUserCompanies(userId),
        api.getAdminCompanies(),
      ]);
      setDetail(d.user);
      setFullName(d.user.full_name);
      setUserCompanies(cs.companies);
      setAdminCos(ac.companies);
      const roleEntries = await Promise.all(
        ac.companies.map(async (co) => {
          try {
            const r = await api.listRoles(co.id);
            return [co.id, r.roles] as const;
          } catch {
            return [co.id, [] as RoleRow[]] as const;
          }
        }),
      );
      setRolesByCompany(Object.fromEntries(roleEntries));
    } catch (e) {
      setError(errMessage(e, 'No se pudo cargar el usuario.'));
    }
  }, [userId, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const canIn = useCallback(
    (coId: string, code: string): boolean => {
      const row = adminCos?.find((c) => c.id === coId);
      if (!row) return false;
      if (row.platform_admin) return true;
      return row.permissions.includes(code);
    },
    [adminCos],
  );

  const run = useCallback(
    async (action: () => Promise<unknown>, targetIsSelf: boolean) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        await load();
        onChanged(targetIsSelf ? userId : undefined);
      } catch (e) {
        setError(errMessage(e, 'La operación no se pudo completar.'));
      } finally {
        setBusy(false);
      }
    },
    [load, onChanged, userId],
  );

  const assignRole = (coId: string, roleId: string) =>
    run(() => api.assignRole(coId, userId, roleId), isSelf);

  const removeRole = (coId: string, roleId: string) =>
    run(() => api.removeRole(coId, userId, roleId), isSelf);

  const grantCompany = (coId: string) => run(() => api.assignCompany(userId, coId), isSelf);
  const revokeCompany = (coId: string) => run(() => api.removeCompany(userId, coId), isSelf);
  const reactivateCompany = (coId: string) => run(() => api.reactivateCompany(userId, coId), isSelf);

  const doConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      if (confirm === 'reset') {
        const r = await api.resetPassword(userId, companyId);
        setConfirm(null);
        onSecret('Contraseña temporal generada', r.temporary_password);
        onChanged(isSelf ? userId : undefined);
        await load();
      } else if (confirm === 'disable') {
        await api.disableUser(userId, companyId);
        setConfirm(null);
        onChanged(isSelf ? userId : undefined);
        await load();
      } else {
        await api.reactivateUser(userId, companyId);
        setConfirm(null);
        onChanged(isSelf ? userId : undefined);
        await load();
      }
    } catch (e) {
      setConfirmError(errMessage(e, 'La operación no se pudo completar.'));
    } finally {
      setConfirmBusy(false);
    }
  };

  if (!detail || !userCompanies || !adminCos) {
    return (
      <Modal title="Detalle de usuario" onClose={onClose}>
        <LoadingRow label="Cargando usuario…" />
      </Modal>
    );
  }

  const membershipByCompany = new Map(userCompanies.map((c) => [c.id, c]));
  const isAdmin = detail.status === 'ACTIVE';

  return (
    <>
      <Modal
        title={detail.full_name}
        subtitle={detail.email}
        onClose={onClose}
        busy={busy}
        className="max-w-4xl"
      >
        <ErrorBox message={error} />

        {/* Estado general */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Pill kind={isAdmin ? 'ok' : 'bad'}>{isAdmin ? 'Cuenta activa' : 'Cuenta deshabilitada'}</Pill>
          <Pill kind={detail.membership_status === 'ACTIVE' ? 'ok' : 'bad'}>
            {detail.membership_status === 'ACTIVE'
              ? `Acceso a ${companyLabel}`
              : `Sin acceso a ${companyLabel}`}
          </Pill>
          <Pill kind={detail.two_factor_enabled ? 'ok' : 'muted'}>
            2FA {detail.two_factor_enabled ? 'activo' : 'inactivo'}
          </Pill>
          {detail.must_change_password && <Pill kind="warn">Debe cambiar contraseña</Pill>}
          {detail.platform_admin && <Pill kind="warn">Administrador de plataforma</Pill>}
          <span className="text-[11px] text-ink-muted num">Último acceso: {fmtDate(detail.last_login_at)}</span>
        </div>

        {/* Tabs de Navegación del Modal */}
        <div className="flex items-center gap-1 border-b border-line mb-4 -mt-1">
          <button
            type="button"
            onClick={() => setModalTab('empresas')}
            className={`px-3 py-2 text-[12px] font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 cursor-pointer ${
              modalTab === 'empresas'
                ? 'border-brand-500 text-ink font-semibold'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Empresas y roles</span>
            <span className="num text-[10px] px-1.5 py-0.2 bg-canvas border border-line rounded text-ink-muted">
              {adminCos.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setModalTab('cuenta')}
            className={`px-3 py-2 text-[12px] font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 cursor-pointer ${
              modalTab === 'cuenta'
                ? 'border-brand-500 text-ink font-semibold'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Datos y cuenta</span>
          </button>

          <button
            type="button"
            onClick={() => setModalTab('sesiones')}
            className={`px-3 py-2 text-[12px] font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 cursor-pointer ${
              modalTab === 'sesiones'
                ? 'border-brand-500 text-ink font-semibold'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Sesiones y seguridad</span>
          </button>
        </div>

        {/* TAB 1: EMPRESAS Y ROLES */}
        {modalTab === 'empresas' && (
          <div className="border border-line rounded-md overflow-hidden">
            <div className="px-3 py-2 bg-canvas border-b border-line flex items-center justify-between">
              <p className="text-[11px] font-medium text-ink-muted uppercase tracking-wide">
                Empresas asignadas y roles
              </p>
              <p className="text-[11px] text-ink-muted">
                {adminCos.length} empresa{adminCos.length === 1 ? '' : 's'} bajo tu administración
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-canvas border-b border-line">
                  <tr>
                    <th className={th}>Empresa</th>
                    <th className={th}>Acceso</th>
                    <th className={th}>Roles</th>
                    <th className={th}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {adminCos.map((co) => {
                    const mem = membershipByCompany.get(co.id);
                    const status = mem?.membership_status ?? 'NONE';
                    const roles = status === 'ACTIVE' ? (mem?.roles ?? []) : [];
                    const available = (rolesByCompany[co.id] ?? []).filter(
                      (r) => !roles.some((assigned) => assigned.code === r.code),
                    );
                    return (
                      <tr key={co.id} className={status === 'ACTIVE' ? '' : 'bg-canvas/50'}>
                        <td className={td}>
                          <span className="font-medium">{co.trade_name || co.legal_name}</span>
                          <span className="block text-[11px] text-ink-muted num">NIT {co.nit}</span>
                        </td>
                        <td className={td}>
                          {status === 'ACTIVE' && <Pill kind="ok">Miembro activo</Pill>}
                          {status === 'DISABLED' && <Pill kind="bad">Acceso quitado</Pill>}
                          {status === 'NONE' && <Pill>Sin acceso</Pill>}
                        </td>
                        <td className={td}>
                          {status !== 'ACTIVE' ? (
                            <span className="text-ink-muted">—</span>
                          ) : roles.length === 0 ? (
                            <span className="text-warning text-[11px]">Sin roles asignados</span>
                          ) : (
                            <span className="flex flex-wrap gap-1">
                              {roles.map((r) => (
                                <Chip
                                  key={r.code}
                                  disabled={
                                    busy ||
                                    !canIn(co.id, 'users.roles.remove') ||
                                    (r.code === 'OWNER' && !canIn(co.id, 'users.roles.assign_owner'))
                                  }
                                  onRemove={
                                    canIn(co.id, 'users.roles.remove') && r.code !== 'OWNER'
                                      ? () => {
                                          const target = (rolesByCompany[co.id] ?? []).find((x) => x.code === r.code);
                                          if (target) void removeRole(co.id, target.id);
                                        }
                                      : r.code === 'OWNER' && canIn(co.id, 'users.roles.assign_owner')
                                        ? () => {
                                            const target = (rolesByCompany[co.id] ?? []).find((x) => x.code === r.code);
                                            if (target) void removeRole(co.id, target.id);
                                          }
                                        : undefined
                                  }
                                >
                                  {r.name}
                                </Chip>
                              ))}
                            </span>
                          )}
                        </td>
                        <td className={`${td} text-right whitespace-nowrap`}>
                          {status === 'ACTIVE' && canIn(co.id, 'users.roles.assign') && available.length > 0 && (
                            <select
                              className={`${control} w-44 inline-block align-top`}
                              value=""
                              disabled={busy}
                              onChange={(e) => {
                                const roleId = e.target.value;
                                if (roleId) void assignRole(co.id, roleId);
                              }}
                            >
                              <option value="">+ Asignar rol…</option>
                              {available.map((r) => (
                                <option
                                  key={r.id}
                                  value={r.id}
                                  disabled={r.code === 'OWNER' && !canIn(co.id, 'users.roles.assign_owner')}
                                >
                                  {r.name}
                                  {r.code === 'OWNER' ? ' (requiere permiso OWNER)' : ''}
                                  {r.company_id ? '' : ' · sistema'}
                                </option>
                              ))}
                            </select>
                          )}
                          {status === 'NONE' && canIn(co.id, 'users.company.assign') && (
                            <button type="button" className={btn} disabled={busy} onClick={() => grantCompany(co.id)}>
                              <Plus className="w-3.5 h-3.5" />
                              Dar acceso
                            </button>
                          )}
                          {status === 'DISABLED' && canIn(co.id, 'users.company.assign') && (
                            <button
                              type="button"
                              className={btn}
                              disabled={busy}
                              onClick={() => reactivateCompany(co.id)}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Reactivar acceso
                            </button>
                          )}
                          {status === 'ACTIVE' && canIn(co.id, 'users.company.remove') && (
                            <button
                              type="button"
                              className={btnDanger}
                              disabled={busy}
                              onClick={() => revokeCompany(co.id)}
                            >
                              Quitar acceso
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {adminCos.length === 0 && (
                    <tr>
                      <td className={td} colSpan={4}>
                        <span className="text-ink-muted">No hay empresas administrables.</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="px-3 py-2 text-[11px] text-ink-muted border-t border-line">
              Solo se listan empresas donde tu cuenta tiene autoridad administrativa. La asignación de
              roles OWNER exige el permiso <code className="num">users.roles.assign_owner</code> y nunca
              se puede quitar el último OWNER de una empresa.
            </p>
          </div>
        )}

        {/* TAB 2: DATOS Y CUENTA */}
        {modalTab === 'cuenta' && (
          <div className="space-y-4">
            <div className="border border-line rounded-md p-4 bg-surface space-y-3">
              <p className="text-[11px] font-medium text-ink-muted uppercase tracking-wide">
                Información del usuario
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <span className="block text-[11px] text-ink-muted mb-1">Nombre completo</span>
                  <div className="flex gap-2">
                    <input
                      className={control}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      disabled={!can('users.update') || busy}
                    />
                    <button
                      type="button"
                      className={btn}
                      disabled={!can('users.update') || busy || !fullName.trim() || fullName.trim() === detail.full_name}
                      onClick={() => void run(() => api.updateUser(userId, companyId, { full_name: fullName.trim() }), isSelf)}
                    >
                      Guardar
                    </button>
                  </div>
                </label>

                <div>
                  <span className="block text-[11px] text-ink-muted mb-1">Correo electrónico</span>
                  <div className="h-8 px-2.5 bg-canvas border border-line rounded-md text-xs flex items-center text-ink font-medium">
                    {detail.email}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-line text-[12px]">
                <div className="flex justify-between py-1 border-b border-line sm:border-b-0">
                  <span className="text-ink-muted">Identificador de cuenta</span>
                  <span className="num font-mono text-ink-muted">{detail.id}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-ink-muted">Fecha de registro</span>
                  <span className="num">{fmtDate(detail.created_at)}</span>
                </div>
              </div>
            </div>

            <div className="border border-line rounded-md p-4 bg-surface space-y-3">
              <p className="text-[11px] font-medium text-ink-muted uppercase tracking-wide">
                Acciones de cuenta
              </p>

              <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-canvas rounded-md border border-line">
                <div>
                  <div className="text-xs font-semibold text-ink">Restablecer contraseña</div>
                  <div className="text-[11px] text-ink-muted mt-0.5">
                    Genera una contraseña temporal de un solo uso que obligará a cambiarla en el próximo inicio.
                  </div>
                </div>
                <button
                  type="button"
                  className={btn}
                  disabled={!can('users.password.reset') || busy}
                  onClick={() => setConfirm('reset')}
                >
                  <KeyRound className="w-3.5 h-3.5 text-ink-muted" />
                  Restablecer contraseña
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-canvas rounded-md border border-line">
                <div>
                  <div className="text-xs font-semibold text-ink">
                    {isAdmin ? 'Deshabilitar cuenta global' : 'Reactivar cuenta global'}
                  </div>
                  <div className="text-[11px] text-ink-muted mt-0.5">
                    {isAdmin
                      ? 'Bloquea el acceso a todas las empresas asociadas y cierra todas las sesiones activas.'
                      : 'Habilita nuevamente la cuenta para que el usuario pueda iniciar sesión.'}
                  </div>
                </div>
                {isAdmin ? (
                  <button
                    type="button"
                    className={btnDanger}
                    disabled={!can('users.disable') || busy}
                    onClick={() => setConfirm('disable')}
                  >
                    <Ban className="w-3.5 h-3.5" />
                    Deshabilitar cuenta
                  </button>
                ) : (
                  <button
                    type="button"
                    className={btn}
                    disabled={!can('users.reactivate') || busy}
                    onClick={() => setConfirm('reactivate')}
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-brand" />
                    Reactivar cuenta
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: SESIONES Y SEGURIDAD */}
        {modalTab === 'sesiones' && (
          <div className="border border-line rounded-md p-4 bg-surface space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-semibold text-ink">Gestión de sesiones activas</h4>
                <p className="text-[11px] text-ink-muted mt-0.5">
                  Supervisa y revoca accesos activos del usuario en todos los dispositivos conectados.
                </p>
              </div>
              <button
                type="button"
                className={btnPrimary}
                disabled={!can('sessions.read')}
                onClick={() => setSessionsOpen(true)}
              >
                <LogOut className="w-3.5 h-3.5" />
                Ver y cerrar sesiones
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-line text-[12px]">
              <div className="p-3 bg-canvas rounded-md border border-line space-y-1.5">
                <div className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted">
                  Autenticación en dos pasos (2FA)
                </div>
                <div className="flex items-center gap-2">
                  <Pill kind={detail.two_factor_enabled ? 'ok' : 'muted'}>
                    {detail.two_factor_enabled ? 'Habilitado y protegido' : 'No configurado'}
                  </Pill>
                </div>
              </div>

              <div className="p-3 bg-canvas rounded-md border border-line space-y-1.5">
                <div className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted">
                  Última actividad
                </div>
                <div className="text-ink font-medium num text-xs">
                  {fmtDate(detail.last_login_at) || 'Sin registros recientes'}
                </div>
              </div>
            </div>

            <div className="text-[11px] text-ink-muted bg-canvas p-3 rounded-md border border-line leading-relaxed">
              <strong>Nota de seguridad:</strong> El cambio o restablecimiento de contraseña revocará automáticamente todas las sesiones abiertas de esta cuenta. Los administradores con permiso <code className="num">sessions.revoke</code> pueden cerrar sesiones puntuales desde el visor de sesiones.
            </div>
          </div>
        )}
      </Modal>

      {sessionsOpen && (
        <SessionsModal
          target={{ id: detail.id, full_name: detail.full_name, email: detail.email }}
          companyId={companyId}
          canRevoke={can('sessions.revoke')}
          onChanged={() => onChanged(isSelf ? userId : undefined)}
          onClose={() => setSessionsOpen(false)}
        />
      )}

      {confirm === 'reset' && (
        <ConfirmModal
          title="Restablecer contraseña"
          message={`Se generará una contraseña temporal para ${detail.email}, se cerrarán todas sus sesiones y deberá cambiarla en el próximo inicio de sesión.`}
          confirmLabel="Restablecer"
          danger
          busy={confirmBusy}
          error={confirmError}
          onConfirm={() => void doConfirm()}
          onClose={() => {
            setConfirm(null);
            setConfirmError(null);
          }}
        />
      )}
      {confirm === 'disable' && (
        <ConfirmModal
          title="Deshabilitar cuenta"
          message={`Se deshabilitará la cuenta de ${detail.full_name} en TODAS sus empresas y se cerrarán sus sesiones. Podrás reactivarla más adelante.`}
          confirmLabel="Deshabilitar"
          danger
          busy={confirmBusy}
          error={confirmError}
          onConfirm={() => void doConfirm()}
          onClose={() => {
            setConfirm(null);
            setConfirmError(null);
          }}
        />
      )}
      {confirm === 'reactivate' && (
        <ConfirmModal
          title="Reactivar cuenta"
          message={`Se reactivará la cuenta de ${detail.full_name}. Sus accesos a empresas se mantienen según la última configuración.`}
          confirmLabel="Reactivar"
          busy={confirmBusy}
          error={confirmError}
          onConfirm={() => void doConfirm()}
          onClose={() => {
            setConfirm(null);
            setConfirmError(null);
          }}
        />
      )}
    </>
  );
};

const UsuariosTab: React.FC<TabProps> = ({ companyId, can, onChanged, onSecret }) => {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUserSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.listUsers(companyId);
      setUsers(r.users);
    } catch (e) {
      setError(errMessage(e, 'No se pudo cargar la lista de usuarios.'));
      setUsers((prev) => prev ?? []);
    }
  }, [companyId]);

  useEffect(() => {
    setUsers(null);
    void load();
  }, [load]);

  const handleChanged = (targetUserId?: string) => {
    void load();
    onChanged(targetUserId);
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-xs text-ink-muted">
          {users === null ? 'Consultando…' : `${users.length} usuario${users.length === 1 ? '' : 's'} con membresía en esta empresa`}
        </p>
        <div className="flex items-center gap-2">
          <button type="button" className={btn} onClick={() => void load()} aria-label="Actualizar">
            <RefreshCw className="w-3.5 h-3.5" />
            Actualizar
          </button>
          {can('users.create') && (
            <button type="button" className={btnPrimary} onClick={() => setCreateOpen(true)}>
              <UserPlus className="w-3.5 h-3.5" />
              Agregar usuario
            </button>
          )}
        </div>
      </div>

      <ErrorBox message={error} />

      <Panel>
        {users === null && <LoadingRow label="Cargando usuarios…" />}
        {users !== null && users.length === 0 && (
          <EmptyState
            title="Sin usuarios"
            description="Esta empresa aún no tiene usuarios con membresía."
            icon={Users}
          />
        )}
        {users !== null && users.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-canvas border-b border-line">
                <tr>
                  <th className={th}>Usuario</th>
                  <th className={th}>Acceso</th>
                  <th className={th}>Roles</th>
                  <th className={th}>Empresas</th>
                  <th className={th}>2FA</th>
                  <th className={th}>Último acceso</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-canvas/60 transition-colors">
                    <td className={td}>
                      <span className="font-medium">{u.full_name}</span>
                      <span className="block text-[11px] text-ink-muted">{u.email}</span>
                    </td>
                    <td className={td}>
                      <span className="flex flex-col gap-1 items-start">
                        <Pill kind={u.status === 'ACTIVE' ? 'ok' : 'bad'}>
                          {u.status === 'ACTIVE' ? 'Cuenta activa' : 'Deshabilitada'}
                        </Pill>
                        {u.membership_status !== 'ACTIVE' && <Pill kind="warn">Acceso quitado</Pill>}
                      </span>
                    </td>
                    <td className={td}>
                      {u.roles.length === 0 ? (
                        <span className="text-warning text-[11px]">Sin roles</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {u.roles.map((code) => (
                            <Chip key={code}>{code}</Chip>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className={`${td} num`}>{u.companies_count}</td>
                    <td className={td}>
                      <Pill kind={u.two_factor_enabled ? 'ok' : 'muted'}>
                        {u.two_factor_enabled ? 'Activo' : 'No'}
                      </Pill>
                    </td>
                    <td className={`${td} num`}>{fmtDate(u.last_login_at)}</td>
                    <td className={`${td} text-right`}>
                      <button type="button" className={btn} onClick={() => setDetailId(u.id)}>
                        Gestionar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {createOpen && (
        <CreateUserModal
          companyId={companyId}
          onClose={() => setCreateOpen(false)}
          onCreated={(temporary) => {
            setCreateOpen(false);
            void load();
            onChanged();
            if (temporary) onSecret('Usuario creado · contraseña temporal', temporary);
          }}
        />
      )}

      {detailId && (
        <UserDetailModal
          userId={detailId}
          companyId={companyId}
          companyLabel="esta empresa"
          can={can}
          isSelf={me?.id === detailId}
          onChanged={handleChanged}
          onSecret={onSecret}
          onClose={() => setDetailId(null)}
        />
      )}
    </>
  );
};

/* ------------------------------------------------------------------ */
/* Pestaña: Roles y permisos                                           */
/* ------------------------------------------------------------------ */

interface RoleDraft {
  id: string | null;
  code: string | null;
  name: string;
  description: string;
  permissions: string[];
  is_system: boolean;
  is_editable: boolean;
}

const RolesTab: React.FC<{ companyId: string; can: (code: string) => boolean }> = ({ companyId, can }) => {
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [permissions, setPermissions] = useState<PermissionRow[] | null>(null);
  const [draft, setDraft] = useState<RoleDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, p] = await Promise.all([api.listRoles(companyId), api.listPermissions()]);
      setRoles(r.roles);
      setPermissions(p.permissions);
      setDraft((prev) => {
        if (!prev) return prev;
        if (prev.id === null) return prev;
        const fresh = r.roles.find((x) => x.id === prev.id);
        return fresh
          ? {
              id: fresh.id,
              code: fresh.code,
              name: fresh.name,
              description: fresh.description ?? '',
              permissions: fresh.permissions,
              is_system: fresh.is_system,
              is_editable: fresh.is_editable,
            }
          : prev;
      });
    } catch (e) {
      setError(errMessage(e, 'No se pudieron cargar los roles.'));
      setRoles((prev) => prev ?? []);
      setPermissions((prev) => prev ?? []);
    }
  }, [companyId]);

  useEffect(() => {
    setRoles(null);
    setPermissions(null);
    setDraft(null);
    void load();
  }, [load]);

  const groups = useMemo(() => {
    if (!permissions) return [];
    const map = new Map<string, PermissionRow[]>();
    for (const p of permissions) {
      const list = map.get(p.category) ?? [];
      list.push(p);
      map.set(p.category, list);
    }
    return [...map.entries()].map(([category, items]) => ({ category, items }));
  }, [permissions]);

  const editable = Boolean(draft && draft.is_editable && can('users.roles.assign'));

  const selectRole = (role: RoleRow) => {
    setSaved(false);
    setDraft({
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description ?? '',
      permissions: role.permissions,
      is_system: role.is_system,
      is_editable: role.is_editable,
    });
  };

  const startNew = () => {
    setSaved(false);
    setDraft({ id: null, code: null, name: '', description: '', permissions: [], is_system: false, is_editable: true });
  };

  const toggle = (code: string) => {
    setSaved(false);
    setDraft((d) =>
      d && d.is_editable
        ? {
            ...d,
            permissions: d.permissions.includes(code)
              ? d.permissions.filter((c) => c !== code)
              : [...d.permissions, code],
          }
        : d,
    );
  };

  const save = async () => {
    if (!draft || !draft.name.trim()) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const input = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        permissions: draft.permissions,
      };
      if (draft.id) {
        await api.updateRole(companyId, draft.id, input);
        await load();
      } else {
        const r = await api.createRole(companyId, input);
        await load();
        setDraft((prev) =>
          prev && prev.id === null
            ? {
                id: r.role.id,
                code: r.role.code,
                name: r.role.name,
                description: r.role.description ?? '',
                permissions: r.role.permissions,
                is_system: r.role.is_system,
                is_editable: r.role.is_editable,
              }
            : prev,
        );
      }
      setSaved(true);
    } catch (e) {
      setError(errMessage(e, 'No se pudo guardar el rol.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <Panel className="lg:col-span-1 p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <p className="text-[11px] font-medium text-ink-muted uppercase tracking-wide">Roles</p>
          {can('users.roles.assign') && (
            <button type="button" className={btn} onClick={startNew}>
              <Plus className="w-3.5 h-3.5" />
              Nuevo rol
            </button>
          )}
        </div>
        {roles === null && <LoadingRow label="Cargando roles…" />}
        {roles !== null && (
          <ul className="divide-y divide-line">
            {roles.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => selectRole(r)}
                  className={`w-full text-left px-4 py-2.5 hover:bg-canvas transition-colors ${
                    draft?.id === r.id ? 'bg-brand-50 border-l-2 border-brand-500' : 'border-l-2 border-transparent'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-ink">{r.name}</span>
                    <Pill kind={r.is_system ? 'muted' : 'ok'}>{r.is_system ? 'Sistema' : 'Personalizado'}</Pill>
                  </span>
                  <span className="block text-[11px] text-ink-muted num">{r.code}</span>
                  <span className="block text-[11px] text-ink-muted">
                    {r.permissions.length} permiso{r.permissions.length === 1 ? '' : 's'}
                  </span>
                </button>
              </li>
            ))}
            {draft && draft.id === null && (
              <li className="px-4 py-2.5 bg-brand-50 border-l-2 border-brand-500">
                <span className="text-[13px] font-medium text-ink">Nuevo rol</span>
                <span className="block text-[11px] text-ink-muted">Sin guardar</span>
              </li>
            )}
          </ul>
        )}
      </Panel>

      <Panel className="lg:col-span-2 p-4">
        <ErrorBox message={error} />
        {!draft && (
          <EmptyState
            title="Selecciona un rol"
            description="Elige un rol de la lista o crea uno nuevo para ver y editar sus permisos."
            icon={Shield}
          />
        )}
        {draft && (
          <>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">
                  {draft.id ? draft.name || '—' : 'Nuevo rol'}
                </p>
                <p className="text-[11px] text-ink-muted num">
                  {draft.code ? `Código: ${draft.code}` : 'El código se genera a partir del nombre'}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {saved && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-success">
                    <Check className="w-3.5 h-3.5" />
                    Guardado
                  </span>
                )}
                {editable && (
                  <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy || !draft.name.trim()}>
                    {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {draft.id ? 'Guardar cambios' : 'Crear rol'}
                  </button>
                )}
              </div>
            </div>

            {draft.is_system && (
              <p className="mb-3 p-2.5 rounded-md bg-canvas border border-line text-[11px] text-ink-muted leading-snug">
                Rol del sistema: su nombre y permisos son fijos y se usan tal cual. Puedes asignarlo o
                quitarlo de los usuarios, pero no modificarlo.
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <label className="block">
                <span className="block text-[11px] text-ink-muted mb-1">Nombre</span>
                <input
                  className={control}
                  value={draft.name}
                  disabled={!editable}
                  onChange={(e) => {
                    setSaved(false);
                    setDraft({ ...draft, name: e.target.value });
                  }}
                />
              </label>
              <label className="block">
                <span className="block text-[11px] text-ink-muted mb-1">Descripción</span>
                <input
                  className={control}
                  value={draft.description}
                  disabled={!editable}
                  onChange={(e) => {
                    setSaved(false);
                    setDraft({ ...draft, description: e.target.value });
                  }}
                />
              </label>
            </div>

            <div className="border border-line rounded-md divide-y divide-line max-h-[46vh] overflow-y-auto">
              {groups.map((group) => (
                <div key={group.category} className="px-3 py-2.5">
                  <p className="text-[11px] font-medium text-ink-muted uppercase tracking-wide mb-1.5">
                    {group.category}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                    {group.items.map((p) => (
                      <label
                        key={p.code}
                        className={`flex items-start gap-2 py-1 text-[12px] ${
                          editable ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'
                        }`}
                        title={p.description}
                      >
                        <input
                          type="checkbox"
                          className="w-3.5 h-3.5 accent-brand mt-0.5 shrink-0"
                          checked={draft.permissions.includes(p.code)}
                          disabled={!editable}
                          onChange={() => toggle(p.code)}
                        />
                        <span className="min-w-0">
                          <span className="text-ink">{p.name}</span>
                          <span className="block text-[10px] text-ink-muted num">{p.code}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-ink-muted">
              {draft.permissions.length} permiso{draft.permissions.length === 1 ? '' : 's'} seleccionado
              {draft.permissions.length === 1 ? '' : 's'}. Los cambios afectan a todos los usuarios que
              tengan este rol en la empresa.
            </p>
          </>
        )}
      </Panel>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Pestaña: Seguridad                                                  */
/* ------------------------------------------------------------------ */

const SeguridadTab: React.FC<TabProps> = ({ companyId, can, onChanged, onSecret }) => {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUserSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUserSummary | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AdminUserSummary | null>(null);
  const [sessionsTarget, setSessionsTarget] = useState<AdminUserSummary | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.listUsers(companyId);
      setUsers(r.users);
    } catch (e) {
      setError(errMessage(e, 'No se pudo cargar la lista de usuarios.'));
      setUsers((prev) => prev ?? []);
    }
  }, [companyId]);

  useEffect(() => {
    setUsers(null);
    void load();
  }, [load]);

  const resetPassword = async (target: AdminUserSummary) => {
    setBusyId(target.id);
    setConfirmError(null);
    try {
      const r = await api.resetPassword(target.id, companyId);
      setResetTarget(null);
      onSecret(`Contraseña temporal · ${target.full_name}`, r.temporary_password);
      onChanged(target.id === me?.id ? target.id : undefined);
    } catch (e) {
      setConfirmError(errMessage(e, 'No se pudo restablecer la contraseña.'));
    } finally {
      setBusyId(null);
    }
  };

  const revokeAll = async (target: AdminUserSummary) => {
    setBusyId(target.id);
    setConfirmError(null);
    try {
      await api.revokeAllSessions(target.id, companyId);
      setRevokeTarget(null);
      onChanged(target.id === me?.id ? target.id : undefined);
    } catch (e) {
      setConfirmError(errMessage(e, 'No se pudieron cerrar las sesiones.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-xs text-ink-muted">
          Contraseñas, sesiones y estado de seguridad de los usuarios de la empresa activa
        </p>
        <button type="button" className={btn} onClick={() => void load()} aria-label="Actualizar">
          <RefreshCw className="w-3.5 h-3.5" />
          Actualizar
        </button>
      </div>

      <ErrorBox message={error} />

      <Panel className="mb-3">
        {users === null && <LoadingRow label="Cargando usuarios…" />}
        {users !== null && users.length === 0 && (
          <EmptyState title="Sin usuarios" description="Esta empresa aún no tiene usuarios." icon={Users} />
        )}
        {users !== null && users.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-canvas border-b border-line">
                <tr>
                  <th className={th}>Usuario</th>
                  <th className={th}>Cuenta</th>
                  <th className={th}>2FA</th>
                  <th className={th}>Cambio de contraseña</th>
                  <th className={th}>Último acceso</th>
                  <th className={th}>Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-canvas/60 transition-colors">
                    <td className={td}>
                      <span className="font-medium">{u.full_name}</span>
                      <span className="block text-[11px] text-ink-muted">{u.email}</span>
                    </td>
                    <td className={td}>
                      <Pill kind={u.status === 'ACTIVE' ? 'ok' : 'bad'}>
                        {u.status === 'ACTIVE' ? 'Activa' : 'Deshabilitada'}
                      </Pill>
                    </td>
                    <td className={td}>
                      <Pill kind={u.two_factor_enabled ? 'ok' : 'muted'}>
                        {u.two_factor_enabled ? 'Activo' : 'No habilitado'}
                      </Pill>
                    </td>
                    <td className={td}>
                      {u.must_change_password ? <Pill kind="warn">Pendiente</Pill> : <span className="text-ink-muted">—</span>}
                    </td>
                    <td className={`${td} num`}>{fmtDate(u.last_login_at)}</td>
                    <td className={td}>
                      <span className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          className={btn}
                          disabled={!can('sessions.read') || busyId === u.id}
                          onClick={() => setSessionsTarget(u)}
                        >
                          Ver sesiones
                        </button>
                        <button
                          type="button"
                          className={btn}
                          disabled={!can('users.password.reset') || busyId === u.id}
                          onClick={() => {
                            setConfirmError(null);
                            setResetTarget(u);
                          }}
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          Restablecer
                        </button>
                        <button
                          type="button"
                          className={btnDanger}
                          disabled={!can('sessions.revoke') || busyId === u.id}
                          onClick={() => {
                            setConfirmError(null);
                            setRevokeTarget(u);
                          }}
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          Cerrar sesiones
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel className="p-4">
        <div className="flex items-start gap-3">
          <Shield className="w-4 h-4 text-ink-faint shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink">Autenticación de dos factores (2FA)</p>
            <p className="text-[12px] text-ink-muted leading-relaxed mt-1">
              El enrolamiento TOTP, los códigos de recuperación y la exigencia de 2FA estarán
              disponibles en la <strong>Fase 4 (MFA TOTP)</strong>. Hoy el estado real de cada usuario
              se muestra en la columna 2FA; las acciones «Exigir 2FA» y «Resetear 2FA» están
              documentadas en el API pero responden{' '}
              <code className="num">501 MFA_NO_DISPONIBLE</code> hasta esa fase. No se simula su
              éxito.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className={btn}
                disabled
                title="Disponible en la Fase 4 (MFA TOTP)"
              >
                Exigir 2FA
              </button>
              <button
                type="button"
                className={btn}
                disabled
                title="Disponible en la Fase 4 (MFA TOTP)"
              >
                Resetear 2FA
              </button>
              <span className="inline-flex items-center text-[11px] text-ink-muted">
                (Fase 4 · MFA TOTP)
              </span>
            </div>
          </div>
        </div>
      </Panel>

      {sessionsTarget && (
        <SessionsModal
          target={sessionsTarget}
          companyId={companyId}
          canRevoke={can('sessions.revoke')}
          onChanged={() => onChanged(sessionsTarget.id === me?.id ? sessionsTarget.id : undefined)}
          onClose={() => setSessionsTarget(null)}
        />
      )}

      {resetTarget && (
        <ConfirmModal
          title="Restablecer contraseña"
          message={`Se generará una contraseña temporal para ${resetTarget.email}, se cerrarán todas sus sesiones y deberá cambiarla en el próximo inicio de sesión.`}
          confirmLabel="Restablecer"
          danger
          busy={busyId === resetTarget.id}
          error={confirmError}
          onConfirm={() => void resetPassword(resetTarget)}
          onClose={() => setResetTarget(null)}
        />
      )}

      {revokeTarget && (
        <ConfirmModal
          title="Cerrar todas las sesiones"
          message={`Se cerrarán todas las sesiones activas de ${revokeTarget.full_name}. Tendrá que volver a iniciar sesión.`}
          confirmLabel="Cerrar sesiones"
          danger
          busy={busyId === revokeTarget.id}
          error={confirmError}
          onConfirm={() => void revokeAll(revokeTarget)}
          onClose={() => setRevokeTarget(null)}
        />
      )}
    </>
  );
};

/* ------------------------------------------------------------------ */
/* Página                                                              */
/* ------------------------------------------------------------------ */

type TabId = 'usuarios' | 'roles' | 'seguridad';

export const UsuariosAcceso: React.FC = () => {
  const { apiCompany } = useApp();
  const { hasPermission, reload } = useAuth();
  const [tab, setTab] = useState<TabId>('usuarios');
  const [secret, setSecret] = useState<{ title: string; secret: string } | null>(null);

  const companyId = apiCompany?.id ?? null;
  const companyLabel = apiCompany ? apiCompany.trade_name || apiCompany.legal_name : '';

  const can = useCallback(
    (code: string) => (companyId ? hasPermission(code, companyId) : false),
    [hasPermission, companyId],
  );

  const handleChanged = useCallback(
    (targetUserId?: string) => {
      if (targetUserId) void reload();
    },
    [reload],
  );

  if (!companyId) {
    return (
      <div className="space-y-4">
        <PageHeader title="Usuarios y acceso" subtitle="Gestión de usuarios, roles y sesiones" />
        <Panel>
          <EmptyState
            title="Selecciona una empresa"
            description="Esta sección administra los usuarios de la empresa activa del selector superior."
            icon={Users}
          />
        </Panel>
      </div>
    );
  }

  const tabs: Array<{ id: TabId; label: string; code: string }> = [
    { id: 'usuarios', label: 'Usuarios', code: 'users.read' },
    { id: 'roles', label: 'Roles y permisos', code: 'users.read' },
    { id: 'seguridad', label: 'Seguridad', code: 'sessions.read' },
  ];
  const visibleTabs = tabs.filter((t) => can(t.code));
  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : (visibleTabs[0]?.id ?? null);

  const tabProps: TabProps = {
    companyId,
    can,
    onChanged: handleChanged,
    onSecret: (title, s) => setSecret({ title, secret: s }),
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Usuarios y acceso"
        subtitle={`${companyLabel} · usuarios, roles, permisos y sesiones`}
      />

      {visibleTabs.length === 0 ? (
        <Panel>
          <EmptyState
            title="Sin permisos en esta empresa"
            description="No tienes permisos de usuarios, roles o sesiones en la empresa activa."
            icon={Shield}
          />
        </Panel>
      ) : (
        <>
          <div className="flex items-center gap-1 border-b border-line">
            {visibleTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-3 py-2 text-[12px] font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === t.id
                    ? 'border-brand-500 text-ink'
                    : 'border-transparent text-ink-muted hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div key={companyId}>
            {activeTab === 'usuarios' && <UsuariosTab {...tabProps} />}
            {activeTab === 'roles' && <RolesTab companyId={companyId} can={can} />}
            {activeTab === 'seguridad' && <SeguridadTab {...tabProps} />}
          </div>
        </>
      )}

      {secret && <SecretModal title={secret.title} secret={secret.secret} onClose={() => setSecret(null)} />}
    </div>
  );
};
