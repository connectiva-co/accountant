import type { Kysely } from 'kysely';
import type { Database, Json } from '../db/schema.js';
import { invalidateAccess } from './permissions.js';
import { audit } from './service.js';

export interface GrantInput {
  companyId: string;
  userId: string;
  roleCode?: string;
  grantedBy?: string | null;
}

/**
 * Crea (o reutiliza) una membresía ACTIVE y le asigna un rol preset.
 * Idempotente: repetir no duplica membership ni role.
 */
export async function grantMembership(
  db: Kysely<Database>,
  input: GrantInput,
): Promise<{ membershipId: string; created: boolean }> {
  const roleCode = input.roleCode ?? 'OWNER';

  const role = await db
    .selectFrom('roles')
    .select(['id'])
    .where('company_id', 'is', null)
    .where('code', '=', roleCode)
    .where('active', '=', true)
    .executeTakeFirst();
  if (!role) throw new Error(`Rol preset no encontrado: ${roleCode}`);

  const existing = await db
    .selectFrom('company_memberships')
    .select(['id', 'status'])
    .where('company_id', '=', input.companyId)
    .where('user_id', '=', input.userId)
    .executeTakeFirst();

  let membershipId: string;
  let created = false;

  if (existing) {
    membershipId = existing.id;
    if (existing.status !== 'ACTIVE') {
      await db
        .updateTable('company_memberships')
        .set({ status: 'ACTIVE', disabled_at: null, disabled_by: null, disabled_reason: null })
        .where('id', '=', existing.id)
        .execute();
      await audit(db, {
        companyId: input.companyId,
        entityType: 'company_memberships',
        entityId: existing.id,
        action: 'MEMBERSHIP_REACTIVATED',
        userId: input.grantedBy ?? null,
        targetUserId: input.userId,
        metadata: { role: roleCode } as Json,
      });
    }
  } else {
    const [inserted] = await db
      .insertInto('company_memberships')
      .values({ company_id: input.companyId, user_id: input.userId, status: 'ACTIVE' })
      .returning('id')
      .execute();
    membershipId = inserted.id;
    created = true;
    await audit(db, {
      companyId: input.companyId,
      entityType: 'company_memberships',
      entityId: membershipId,
      action: 'MEMBERSHIP_CREATED',
      userId: input.grantedBy ?? input.userId,
      targetUserId: input.userId,
      metadata: { role: roleCode, via: input.grantedBy ? 'admin' : 'self' } as Json,
    });
  }

  await db
    .insertInto('membership_roles')
    .values({ membership_id: membershipId, role_id: role.id })
    .onConflict((oc) => oc.columns(['membership_id', 'role_id']).doNothing())
    .execute();

  invalidateAccess(input.userId);
  return { membershipId, created };
}

/** Revoca (soft: status DISABLED) el acceso de un usuario a una empresa. */
export async function revokeMembership(
  db: Kysely<Database>,
  input: { companyId: string; userId: string; revokedBy: string; reason?: string },
): Promise<boolean> {
  const membership = await db
    .selectFrom('company_memberships')
    .select(['id', 'status'])
    .where('company_id', '=', input.companyId)
    .where('user_id', '=', input.userId)
    .executeTakeFirst();
  if (!membership || membership.status === 'DISABLED') return false;

  await db
    .updateTable('company_memberships')
    .set({
      status: 'DISABLED',
      disabled_at: new Date(),
      disabled_by: input.revokedBy,
      disabled_reason: input.reason ?? null,
    })
    .where('id', '=', membership.id)
    .execute();

  await audit(db, {
    companyId: input.companyId,
    entityType: 'company_memberships',
    entityId: membership.id,
    action: 'MEMBERSHIP_DISABLED',
    userId: input.revokedBy,
    targetUserId: input.userId,
    metadata: { reason: input.reason ?? null } as Json,
  });

  invalidateAccess(input.userId);
  return true;
}

/** Número de miembros ACTIVE con un rol determinado (protección del último OWNER). */
export async function countMembersWithRole(
  db: Kysely<Database>,
  companyId: string,
  roleCode: string,
): Promise<number> {
  const rows = await db
    .selectFrom('company_memberships')
    .innerJoin('membership_roles', 'membership_roles.membership_id', 'company_memberships.id')
    .innerJoin('roles', 'roles.id', 'membership_roles.role_id')
    .select('company_memberships.id as id')
    .where('company_memberships.company_id', '=', companyId)
    .where('company_memberships.status', '=', 'ACTIVE')
    .where('roles.code', '=', roleCode)
    .execute();
  return new Set(rows.map((r) => r.id)).size;
}
