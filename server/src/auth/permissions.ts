import type { Kysely } from 'kysely';
import { PERMISSION_CACHE_TTL_MS } from './constants.js';
import type { Database, User } from '../db/schema.js';

/**
 * Acceso efectivo de un usuario a UNA empresa.
 * No existe si no hay company_membership con status ACTIVE: conocer el
 * company_id nunca es suficiente.
 */
export interface CompanyAccess {
  companyId: string;
  membershipId: string;
  roles: string[];
  permissions: Set<string>;
  platformAdmin: boolean;
}

interface CacheEntry {
  value: unknown;
  expires: number;
}

const cache = new Map<string, CacheEntry>();

function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function cacheSet(key: string, value: unknown): void {
  cache.set(key, { value, expires: Date.now() + PERMISSION_CACHE_TTL_MS });
}

/** Invalidación tras cambios de roles/membresías (Fase 3) o de permisos. */
export function invalidateAccess(userId?: string): void {
  if (!userId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}:`) || key.startsWith(`g:${userId}:`)) cache.delete(key);
  }
}

export async function resolveCompanyAccess(
  db: Kysely<Database>,
  user: Pick<User, 'id' | 'platform_admin'>,
  companyId: string,
): Promise<CompanyAccess | null> {
  const key = `${user.id}:${companyId}`;
  const cached = cacheGet<CompanyAccess | null>(key);
  if (cached !== undefined) return cached;

  const membership = await db
    .selectFrom('company_memberships')
    .select(['id'])
    .where('user_id', '=', user.id)
    .where('company_id', '=', companyId)
    .where('status', '=', 'ACTIVE')
    .executeTakeFirst();

  if (!membership) {
    cacheSet(key, null);
    return null;
  }

  const rows = await db
    .selectFrom('membership_roles')
    .innerJoin('roles', 'roles.id', 'membership_roles.role_id')
    .innerJoin('role_permissions', 'role_permissions.role_id', 'roles.id')
    .innerJoin('permissions', 'permissions.id', 'role_permissions.permission_id')
    .select(['roles.code as role_code', 'permissions.code as permission_code'])
    .where('membership_roles.membership_id', '=', membership.id)
    .where('roles.active', '=', true)
    .execute();

  const roles = [...new Set(rows.map((r) => r.role_code))];
  const permissions = new Set(rows.map((r) => r.permission_code));

  const access: CompanyAccess = {
    companyId,
    membershipId: membership.id,
    roles,
    permissions,
    platformAdmin: Boolean(user.platform_admin),
  };
  cacheSet(key, access);
  return access;
}

export function hasPermission(access: CompanyAccess | null | undefined, code: string): boolean {
  if (!access) return false;
  if (access.platformAdmin) return true;
  return access.permissions.has(code);
}

/**
 * Permiso aplicable sin empresa (settings globales, importaciones):
 * plataforma o cualquier membresía activa que conceda el código.
 */
export async function hasGlobalPermission(
  db: Kysely<Database>,
  user: Pick<User, 'id' | 'platform_admin'>,
  code: string,
): Promise<boolean> {
  if (user.platform_admin) return true;

  const key = `g:${user.id}:${code}`;
  const cached = cacheGet<boolean>(key);
  if (cached !== undefined) return cached;

  const row = await db
    .selectFrom('company_memberships')
    .innerJoin('membership_roles', 'membership_roles.membership_id', 'company_memberships.id')
    .innerJoin('roles', 'roles.id', 'membership_roles.role_id')
    .innerJoin('role_permissions', 'role_permissions.role_id', 'roles.id')
    .innerJoin('permissions', 'permissions.id', 'role_permissions.permission_id')
    .select('permissions.id as id')
    .where('company_memberships.user_id', '=', user.id)
    .where('company_memberships.status', '=', 'ACTIVE')
    .where('roles.active', '=', true)
    .where('permissions.code', '=', code)
    .limit(1)
    .executeTakeFirst();

  const granted = Boolean(row);
  cacheSet(key, granted);
  return granted;
}

export interface MemberCompany {
  id: string;
  nit: string;
  legal_name: string;
  trade_name: string | null;
  currency: string;
  timezone: string;
  active: boolean;
  roles: string[];
  membership_id: string;
}

/** Empresas del usuario con membresía ACTIVE (base del selector). */
export async function listMemberCompanies(
  db: Kysely<Database>,
  userId: string,
): Promise<MemberCompany[]> {
  const memberships = await db
    .selectFrom('company_memberships')
    .innerJoin('companies', 'companies.id', 'company_memberships.company_id')
    .select([
      'companies.id as id',
      'companies.nit as nit',
      'companies.legal_name as legal_name',
      'companies.trade_name as trade_name',
      'companies.currency as currency',
      'companies.timezone as timezone',
      'companies.active as active',
      'company_memberships.id as membership_id',
    ])
    .where('company_memberships.user_id', '=', userId)
    .where('company_memberships.status', '=', 'ACTIVE')
    .orderBy('companies.legal_name')
    .execute();

  if (memberships.length === 0) return [];

  const roleRows = await db
    .selectFrom('company_memberships')
    .innerJoin('membership_roles', 'membership_roles.membership_id', 'company_memberships.id')
    .innerJoin('roles', 'roles.id', 'membership_roles.role_id')
    .select(['company_memberships.company_id as company_id', 'roles.code as code'])
    .where(
      'company_memberships.id',
      'in',
      memberships.map((m) => m.membership_id),
    )
    .where('company_memberships.status', '=', 'ACTIVE')
    .where('roles.active', '=', true)
    .execute();

  const byCompany = new Map<string, string[]>();
  for (const row of roleRows) {
    const list = byCompany.get(row.company_id) ?? [];
    list.push(row.code);
    byCompany.set(row.company_id, list);
  }

  return memberships.map((m) => ({ ...m, roles: byCompany.get(m.id) ?? [] }));
}

export interface PermissionRow {
  code: string;
  requires_step_up: boolean;
}

export async function getPermission(
  db: Kysely<Database>,
  code: string,
): Promise<PermissionRow | null> {
  const key = `perm:${code}`;
  const cached = cacheGet<PermissionRow | null>(key);
  if (cached !== undefined) return cached;

  const row = await db
    .selectFrom('permissions')
    .select(['code', 'requires_step_up'])
    .where('code', '=', code)
    .executeTakeFirst();

  const value = row ?? null;
  cacheSet(key, value);
  return value;
}
