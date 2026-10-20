import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import type { Guards } from '../auth/guards.js';
import { HttpError } from './errors.js';
import { audit } from '../auth/service.js';
import { hashPassword, assertPasswordPolicy, PasswordPolicyError } from '../auth/passwords.js';
import { randomToken } from '../auth/tokens.js';
import { revokeUserSessions } from '../auth/sessions.js';
import { resolveCompanyAccess, hasPermission, invalidateAccess } from '../auth/permissions.js';
import type { User } from '../db/schema.js';

const parse = <S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> => {
  const res = schema.safeParse(value);
  if (!res.success) {
    throw new HttpError(400, 'INVALIDO', res.error.issues[0]?.message ?? 'Dato inválido.');
  }
  return res.data;
};

const queryCompanyId = z.object({ company_id: z.string().uuid() });
const userCreate = z.object({
  email: z.string().email().max(254),
  full_name: z.string().min(1).max(200),
  password: z.string().min(1).max(200).optional(),
});
const userUpdate = z.object({
  full_name: z.string().min(1).max(200).optional(),
});
const roleUpsert = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(300).optional().nullable(),
  permissions: z.array(z.string().min(1).max(80)).max(100),
});

export function registerAdminRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  guards: Guards,
): void {
  const requestMeta = (req: FastifyRequest) => ({
    ip: req.ip,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  });

  /** Cuenta OWNERs activos de una empresa (opcionalmente excluyendo a uno). */
  async function countActiveOwners(companyId: string, excludeUserId?: string): Promise<number> {
    const rows = await db
      .selectFrom('company_memberships')
      .innerJoin('membership_roles', 'membership_roles.membership_id', 'company_memberships.id')
      .innerJoin('roles', 'roles.id', 'membership_roles.role_id')
      .select('company_memberships.user_id as user_id')
      .where('company_memberships.company_id', '=', companyId)
      .where('company_memberships.status', '=', 'ACTIVE')
      .where('roles.code', '=', 'OWNER')
      .where('roles.active', '=', true)
      .execute();
    return rows.filter((r) => r.user_id !== excludeUserId).length;
  }

  /** No permitir perder el último OWNER activo de una empresa. */
  async function assertNotLastOwner(companyId: string, userId: string, message: string): Promise<void> {
    const holdsOwner = await db
      .selectFrom('company_memberships')
      .innerJoin('membership_roles', 'membership_roles.membership_id', 'company_memberships.id')
      .innerJoin('roles', 'roles.id', 'membership_roles.role_id')
      .select('company_memberships.id as id')
      .where('company_memberships.company_id', '=', companyId)
      .where('company_memberships.user_id', '=', userId)
      .where('company_memberships.status', '=', 'ACTIVE')
      .where('roles.code', '=', 'OWNER')
      .executeTakeFirst();
    if (!holdsOwner) return;
    if ((await countActiveOwners(companyId, userId)) === 0) {
      throw new HttpError(409, 'ULTIMO_OWNER', message);
    }
  }

  /** Empresas donde el actor tiene autoridad administrativa (users.company.assign). */
  async function adminCompanies(user: User): Promise<Array<{ company: { id: string; nit: string; legal_name: string; trade_name: string | null }; permissions: string[]; platform_admin: boolean }>> {
    const memberships = await db
      .selectFrom('company_memberships')
      .innerJoin('companies', 'companies.id', 'company_memberships.company_id')
      .select(['companies.id', 'companies.nit', 'companies.legal_name', 'companies.trade_name'])
      .where('company_memberships.user_id', '=', user.id)
      .where('company_memberships.status', '=', 'ACTIVE')
      .orderBy('companies.legal_name')
      .execute();
    const out = [];
    for (const company of memberships) {
      const access = await resolveCompanyAccess(db, user, company.id);
      if (!access) continue;
      // Solo empresas donde el actor puede gestionar usuarios (o es platform admin).
      if (!access.platformAdmin && !hasPermission(access, 'users.company.assign')) continue;
      out.push({
        company,
        permissions: access.platformAdmin ? [] : [...access.permissions],
        platform_admin: access.platformAdmin,
      });
    }
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* Usuarios                                                          */
  /* ---------------------------------------------------------------- */

  app.get(
    '/api/users',
    { preHandler: [guards.requireCompany, guards.requirePermission('users.read')] },
    async (req: FastifyRequest) => {
      const { company_id: companyId } = parse(queryCompanyId, req.query);
      const memberships = await db
        .selectFrom('company_memberships')
        .innerJoin('users', 'users.id', 'company_memberships.user_id')
        .select([
          'users.id as id',
          'users.email as email',
          'users.full_name as full_name',
          'users.status as status',
          'users.last_login_at as last_login_at',
          'users.two_factor_enabled as two_factor_enabled',
          'users.must_change_password as must_change_password',
          'company_memberships.id as membership_id',
          'company_memberships.status as membership_status',
        ])
        .where('company_memberships.company_id', '=', companyId)
        .orderBy('users.full_name')
        .execute();

      if (memberships.length === 0) return { users: [] };

      const roleRows = await db
        .selectFrom('membership_roles')
        .innerJoin('roles', 'roles.id', 'membership_roles.role_id')
        .select(['membership_roles.membership_id as membership_id', 'roles.code as code'])
        .where(
          'membership_roles.membership_id',
          'in',
          memberships.map((m) => m.membership_id),
        )
        .where('roles.active', '=', true)
        .execute();
      const rolesByMembership = new Map<string, string[]>();
      for (const row of roleRows) {
        const list = rolesByMembership.get(row.membership_id) ?? [];
        list.push(row.code);
        rolesByMembership.set(row.membership_id, list);
      }

      const companyCounts = await db
        .selectFrom('company_memberships')
        .select(['user_id', db.fn.countAll().as('total')])
        .where('status', '=', 'ACTIVE')
        .where(
          'user_id',
          'in',
          memberships.map((m) => m.id),
        )
        .groupBy('user_id')
        .execute();
      const countByUser = new Map<string, number>(companyCounts.map((c) => [c.user_id, Number(c.total)]));

      return {
        users: memberships.map((m) => ({
          id: m.id,
          email: m.email,
          full_name: m.full_name,
          status: m.status,
          last_login_at: m.last_login_at,
          two_factor_enabled: m.two_factor_enabled,
          must_change_password: m.must_change_password,
          membership_status: m.membership_status,
          roles: rolesByMembership.get(m.membership_id) ?? [],
          companies_count: countByUser.get(m.id) ?? 1,
        })),
      };
    },
  );

  app.post(
    '/api/users',
    { preHandler: [guards.requireCompany, guards.requirePermission('users.create')] },
    async (req: FastifyRequest) => {
      const { company_id: companyId } = parse(queryCompanyId, req.query);
      const body = parse(userCreate, req.body);
      const email = body.email.trim().toLowerCase();

      const exists = await db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst();
      if (exists) {
        // El usuario ya existe en la plataforma: verificar si tiene membresía en esta empresa
        const existingMem = await db
          .selectFrom('company_memberships')
          .selectAll()
          .where('user_id', '=', exists.id)
          .where('company_id', '=', companyId)
          .executeTakeFirst();

        if (existingMem) {
          if (existingMem.status === 'ACTIVE') {
            throw new HttpError(409, 'EXISTE', 'El usuario ya tiene acceso activo a esta empresa.');
          }
          await db
            .updateTable('company_memberships')
            .set({ status: 'ACTIVE' })
            .where('id', '=', existingMem.id)
            .execute();

          await audit(db, {
            action: 'MEMBERSHIP_REACTIVATED',
            entityType: 'company_memberships',
            entityId: existingMem.id,
            userId: guards.principal(req).user.id,
            targetUserId: exists.id,
            companyId,
            metadata: { email },
            ...requestMeta(req),
          });

          return { user: { id: exists.id, email: exists.email, full_name: exists.full_name, temporary_password: null } };
        }

        const membership = await db
          .insertInto('company_memberships')
          .values({ user_id: exists.id, company_id: companyId, status: 'ACTIVE' })
          .returning('id')
          .executeTakeFirstOrThrow();

        await audit(db, {
          action: 'MEMBERSHIP_CREATED',
          entityType: 'company_memberships',
          entityId: membership.id,
          userId: guards.principal(req).user.id,
          targetUserId: exists.id,
          companyId,
          metadata: { email, added_to_company: companyId },
          ...requestMeta(req),
        });

        return { user: { id: exists.id, email: exists.email, full_name: exists.full_name, temporary_password: null } };
      }

      let tempPassword: string | null = null;
      let passwordHash: string;
      if (body.password) {
        try {
          assertPasswordPolicy(body.password);
        } catch (error) {
          if (error instanceof PasswordPolicyError) throw new HttpError(422, 'POLITICA_PASSWORD', error.message);
          throw error;
        }
        passwordHash = await hashPassword(body.password);
      } else {
        tempPassword = `Acc-${randomToken(12)}-9a`;
        passwordHash = await hashPassword(tempPassword);
      }

      const user = await db
        .insertInto('users')
        .values({
          email,
          full_name: body.full_name.trim(),
          password_hash: passwordHash,
          must_change_password: tempPassword !== null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Membresía inicial en la empresa desde la que se crea.
      const membership = await db
        .insertInto('company_memberships')
        .values({ user_id: user.id, company_id: companyId, status: 'ACTIVE' })
        .returning('id')
        .executeTakeFirstOrThrow();

      await audit(db, {
        action: 'USER_CREATED',
        entityType: 'users',
        entityId: user.id,
        userId: guards.principal(req).user.id,
        targetUserId: user.id,
        companyId,
        metadata: { email, created_in_company: companyId },
        ...requestMeta(req),
      });
      await audit(db, {
        action: 'MEMBERSHIP_CREATED',
        entityType: 'company_memberships',
        entityId: membership.id,
        userId: guards.principal(req).user.id,
        targetUserId: user.id,
        companyId,
        ...requestMeta(req),
      });

      invalidateAccess(user.id);
      return {
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          status: user.status,
          last_login_at: user.last_login_at,
          two_factor_enabled: user.two_factor_enabled,
          must_change_password: user.must_change_password,
          membership_status: 'ACTIVE',
          roles: [],
          companies_count: 1,
        },
        temporary_password: tempPassword,
      };
    },
  );

  app.get(
    '/api/users/:id',
    { preHandler: [guards.requireCompany, guards.requirePermission('users.read')] },
    async (req: FastifyRequest) => {
      const { company_id: companyId } = parse(queryCompanyId, req.query);
      const params = req.params as { id: string };
      const user = await db
        .selectFrom('users')
        .select([
          'id',
          'email',
          'full_name',
          'status',
          'must_change_password',
          'platform_admin',
          'last_login_at',
          'two_factor_enabled',
          'created_at',
        ])
        .where('id', '=', params.id)
        .executeTakeFirst();
      if (!user) throw new HttpError(404, 'NO_ENCONTRADO', 'Usuario no encontrado.');
      // Debe pertenecer a la empresa desde la que se consulta.
      const membership = await db
        .selectFrom('company_memberships')
        .select(['id', 'status'])
        .where('user_id', '=', user.id)
        .where('company_id', '=', companyId)
        .executeTakeFirst();
      if (!membership) throw new HttpError(403, 'SIN_ACCESO', 'El usuario no pertenece a esta empresa.');
      return { user: { ...user, membership_status: membership.status } };
    },
  );

  app.put(
    '/api/users/:id',
    { preHandler: [guards.requireCompany, guards.requirePermission('users.update')] },
    async (req: FastifyRequest) => {
      const { company_id: companyId } = parse(queryCompanyId, req.query);
      const params = req.params as { id: string };
      const body = parse(userUpdate, req.body);
      const target = await db.selectFrom('users').select(['id', 'status']).where('id', '=', params.id).executeTakeFirst();
      if (!target) throw new HttpError(404, 'NO_ENCONTRADO', 'Usuario no encontrado.');

      const updated = await db
        .updateTable('users')
        .set({
          ...(body.full_name !== undefined ? { full_name: body.full_name.trim() } : {}),
        })
        .where('id', '=', params.id)
        .returning(['id', 'email', 'full_name', 'status', 'last_login_at', 'two_factor_enabled', 'must_change_password'])
        .executeTakeFirstOrThrow();

      await audit(db, {
        action: 'USER_UPDATED',
        entityType: 'users',
        entityId: params.id,
        userId: guards.principal(req).user.id,
        targetUserId: params.id,
        companyId,
        ...requestMeta(req),
      });
      return { user: updated };
    },
  );

  app.post(
    '/api/users/:id/disable',
    { preHandler: [guards.requireCompany, guards.requirePermission('users.disable')] },
    async (req: FastifyRequest) => {
      const { company_id: companyId } = parse(queryCompanyId, req.query);
      const params = req.params as { id: string };
      await assertNotLastOwnerOfAnyCompany(params.id, 'No se puede deshabilitar al último OWNER de una empresa.');
      const updated = await db
        .updateTable('users')
        .set({ status: 'DISABLED' })
        .where('id', '=', params.id)
        .returning(['id', 'email', 'full_name', 'status'])
        .executeTakeFirst();
      if (!updated) throw new HttpError(404, 'NO_ENCONTRADO', 'Usuario no encontrado.');
      await revokeUserSessions(db, params.id, 'USER_DISABLED');
      invalidateAccess(params.id);
      await audit(db, {
        action: 'USER_DISABLED',
        entityType: 'users',
        entityId: params.id,
        userId: guards.principal(req).user.id,
        targetUserId: params.id,
        companyId,
        ...requestMeta(req),
      });
      return { user: updated };
    },
  );

  app.post(
    '/api/users/:id/reactivate',
    { preHandler: [guards.requireCompany, guards.requirePermission('users.reactivate')] },
    async (req: FastifyRequest) => {
      const { company_id: companyId } = parse(queryCompanyId, req.query);
      const params = req.params as { id: string };
      const updated = await db
        .updateTable('users')
        .set({ status: 'ACTIVE', locked_until: null, failed_attempts: 0 })
        .where('id', '=', params.id)
        .returning(['id', 'email', 'full_name', 'status'])
        .executeTakeFirst();
      if (!updated) throw new HttpError(404, 'NO_ENCONTRADO', 'Usuario no encontrado.');
      invalidateAccess(params.id);
      await audit(db, {
        action: 'USER_REACTIVATED',
        entityType: 'users',
        entityId: params.id,
        userId: guards.principal(req).user.id,
        targetUserId: params.id,
        companyId,
        ...requestMeta(req),
      });
      return { user: updated };
    },
  );

  async function assertNotLastOwnerOfAnyCompany(userId: string, message: string): Promise<void> {
    const ownerMemberships = await db
      .selectFrom('company_memberships')
      .innerJoin('membership_roles', 'membership_roles.membership_id', 'company_memberships.id')
      .innerJoin('roles', 'roles.id', 'membership_roles.role_id')
      .select('company_memberships.company_id as company_id')
      .where('company_memberships.user_id', '=', userId)
      .where('company_memberships.status', '=', 'ACTIVE')
      .where('roles.code', '=', 'OWNER')
      .execute();
    for (const row of ownerMemberships) {
      if ((await countActiveOwners(row.company_id, userId)) === 0) {
        throw new HttpError(409, 'ULTIMO_OWNER', message);
      }
    }
  }

  app.post(
    '/api/users/:id/reset-password',
    { preHandler: [guards.requireCompany, guards.requirePermission('users.password.reset')] },
    async (req: FastifyRequest) => {
      const { company_id: companyId } = parse(queryCompanyId, req.query);
      const params = req.params as { id: string };
      const body = parse(
        z.object({ temporary_password: z.string().min(1).max(200).optional() }),
        req.body ?? {},
      );

      const target = await db.selectFrom('users').select(['id', 'email']).where('id', '=', params.id).executeTakeFirst();
      if (!target) throw new HttpError(404, 'NO_ENCONTRADO', 'Usuario no encontrado.');

      let temporary: string;
      if (body.temporary_password) {
        try {
          assertPasswordPolicy(body.temporary_password);
        } catch (error) {
          if (error instanceof PasswordPolicyError) throw new HttpError(422, 'POLITICA_PASSWORD', error.message);
          throw error;
        }
        temporary = body.temporary_password;
      } else {
        temporary = `Acc-${randomToken(12)}-9a`;
      }

      await db
        .updateTable('users')
        .set({ password_hash: await hashPassword(temporary), must_change_password: true, failed_attempts: 0, locked_until: null })
        .where('id', '=', params.id)
        .execute();
      await revokeUserSessions(db, params.id, 'PASSWORD_RESET');

      await audit(db, {
        action: 'PASSWORD_RESET_REQUESTED',
        entityType: 'users',
        entityId: params.id,
        userId: guards.principal(req).user.id,
        targetUserId: params.id,
        companyId,
        ...requestMeta(req),
      });

      return { ok: true, temporary_password: temporary };
    },
  );

  /* ---------------------------------------------------------------- */
  /* Memberships                                                       */
  /* ---------------------------------------------------------------- */

  app.get(
    '/api/users/:id/companies',
    { preHandler: [guards.requireAuth, guards.requirePermission('users.read')] },
    async (req: FastifyRequest) => {
      const params = req.params as { id: string };
      // Solo empresas donde el actor tiene autoridad administrativa.
      const allowed = new Set((await adminCompanies(guards.principal(req).user)).map((c) => c.company.id));
      const rows = await db
        .selectFrom('company_memberships')
        .innerJoin('companies', 'companies.id', 'company_memberships.company_id')
        .select([
          'companies.id',
          'companies.nit',
          'companies.legal_name',
          'companies.trade_name',
          'company_memberships.status as membership_status',
          'company_memberships.id as membership_id',
        ])
        .where('company_memberships.user_id', '=', params.id)
        .orderBy('companies.legal_name')
        .execute();

      const scoped = rows.filter((r) => allowed.has(r.id));
      const activeIds = scoped.filter((r) => r.membership_status === 'ACTIVE').map((r) => r.membership_id);
      const roleRows = activeIds.length
        ? await db
            .selectFrom('membership_roles')
            .innerJoin('roles', 'roles.id', 'membership_roles.role_id')
            .select(['membership_roles.membership_id as membership_id', 'roles.code as code', 'roles.name as name'])
            .where('membership_roles.membership_id', 'in', activeIds)
            .where('roles.active', '=', true)
            .execute()
        : [];
      const byMembership = new Map<string, Array<{ code: string; name: string }>>();
      for (const row of roleRows) {
        const list = byMembership.get(row.membership_id) ?? [];
        list.push({ code: row.code, name: row.name });
        byMembership.set(row.membership_id, list);
      }

      return {
        companies: scoped.map((r) => ({
          id: r.id,
          nit: r.nit,
          legal_name: r.legal_name,
          trade_name: r.trade_name,
          membership_status: r.membership_status,
          membership_id: r.membership_id,
          roles: byMembership.get(r.membership_id) ?? [],
        })),
      };
    },
  );

  app.post(
    '/api/users/:id/companies/:companyId',
    { preHandler: [guards.requireCompany, guards.requirePermission('users.company.assign')] },
    async (req: FastifyRequest) => {
      const params = req.params as { id: string; companyId: string };
      const existing = await db
        .selectFrom('company_memberships')
        .select(['id', 'status'])
        .where('user_id', '=', params.id)
        .where('company_id', '=', params.companyId)
        .executeTakeFirst();

      let membershipId: string;
      if (!existing) {
        const inserted = await db
          .insertInto('company_memberships')
          .values({ user_id: params.id, company_id: params.companyId, status: 'ACTIVE' })
          .returning('id')
          .executeTakeFirstOrThrow();
        membershipId = inserted.id;
      } else {
        membershipId = existing.id;
        if (existing.status !== 'ACTIVE') {
          await db
            .updateTable('company_memberships')
            .set({ status: 'ACTIVE', disabled_at: null })
            .where('id', '=', existing.id)
            .execute();
        }
      }
      invalidateAccess(params.id);

      await audit(db, {
        action: 'MEMBERSHIP_CREATED',
        entityType: 'company_memberships',
        entityId: membershipId,
        userId: guards.principal(req).user.id,
        targetUserId: params.id,
        companyId: params.companyId,
        ...requestMeta(req),
      });
      return { ok: true, membership_id: membershipId };
    },
  );

  app.post(
    '/api/users/:id/companies/:companyId/disable',
    { preHandler: [guards.requireCompany, guards.requirePermission('users.company.remove')] },
    async (req: FastifyRequest) => {
      const params = req.params as { id: string; companyId: string };
      await assertNotLastOwner(
        params.companyId,
        params.id,
        'No se puede quitar la empresa al último OWNER.',
      );
      const membership = await db
        .selectFrom('company_memberships')
        .select(['id', 'status'])
        .where('user_id', '=', params.id)
        .where('company_id', '=', params.companyId)
        .executeTakeFirst();
      if (membership && membership.status === 'ACTIVE') {
        await db
          .updateTable('company_memberships')
          .set({ status: 'DISABLED', disabled_at: new Date() })
          .where('id', '=', membership.id)
          .execute();
        invalidateAccess(params.id);
        await audit(db, {
          action: 'MEMBERSHIP_DISABLED',
          entityType: 'company_memberships',
          entityId: membership.id,
          userId: guards.principal(req).user.id,
          targetUserId: params.id,
          companyId: params.companyId,
          ...requestMeta(req),
        });
      }
      return { ok: true };
    },
  );

  app.post(
    '/api/users/:id/companies/:companyId/reactivate',
    { preHandler: [guards.requireCompany, guards.requirePermission('users.company.assign')] },
    async (req: FastifyRequest) => {
      const params = req.params as { id: string; companyId: string };
      const membership = await db
        .selectFrom('company_memberships')
        .select(['id', 'status'])
        .where('user_id', '=', params.id)
        .where('company_id', '=', params.companyId)
        .executeTakeFirst();
      if (membership && membership.status !== 'ACTIVE') {
        await db
          .updateTable('company_memberships')
          .set({ status: 'ACTIVE', disabled_at: null })
          .where('id', '=', membership.id)
          .execute();
        invalidateAccess(params.id);
        await audit(db, {
          action: 'MEMBERSHIP_REACTIVATED',
          entityType: 'company_memberships',
          entityId: membership.id,
          userId: guards.principal(req).user.id,
          targetUserId: params.id,
          companyId: params.companyId,
          ...requestMeta(req),
        });
      }
      return { ok: true };
    },
  );

  /* ---------------------------------------------------------------- */
  /* Empresas administrables por el actor                              */
  /* ---------------------------------------------------------------- */

  app.get('/api/admin/companies', { preHandler: guards.requireAuth }, async (req: FastifyRequest) => {
    const user = guards.principal(req).user;
    const companies = await adminCompanies(user);
    return {
      companies: companies.map((c) => ({
        ...c.company,
        permissions: c.permissions,
        platform_admin: Boolean(c.platform_admin),
      })),
    };
  });

  /* ---------------------------------------------------------------- */
  /* Catálogo de permisos                                              */
  /* ---------------------------------------------------------------- */

  app.get('/api/permissions', { preHandler: guards.requireAuth }, async () => {
    const rows = await db
      .selectFrom('permissions')
      .select(['id', 'code', 'name', 'description', 'category', 'risk_level', 'requires_step_up'])
      .orderBy('category')
      .orderBy('code')
      .execute();
    return { permissions: rows };
  });

  /* ---------------------------------------------------------------- */
  /* Roles por empresa                                                 */
  /* ---------------------------------------------------------------- */

  app.get(
    '/api/companies/:companyId/roles',
    { preHandler: [guards.requireCompany, guards.requirePermission('users.read')] },
    async (req: FastifyRequest) => {
      const params = req.params as { companyId: string };
      const roles = await db
        .selectFrom('roles')
        .select(['id', 'company_id', 'code', 'name', 'description', 'is_system', 'is_editable', 'active'])
        .where((eb) => eb.or([eb('company_id', '=', params.companyId), eb('company_id', 'is', null)]))
        .where('active', '=', true)
        .orderBy('is_system', 'desc')
        .orderBy('name')
        .execute();
      const roleIds = roles.map((r) => r.id);
      const permRows = roleIds.length
        ? await db
            .selectFrom('role_permissions')
            .innerJoin('permissions', 'permissions.id', 'role_permissions.permission_id')
            .select(['role_permissions.role_id as role_id', 'permissions.code as code'])
            .where('role_permissions.role_id', 'in', roleIds)
            .execute()
        : [];
      const byRole = new Map<string, string[]>();
      for (const row of permRows) {
        const list = byRole.get(row.role_id) ?? [];
        list.push(row.code);
        byRole.set(row.role_id, list);
      }
      return { roles: roles.map((r) => ({ ...r, permissions: byRole.get(r.id) ?? [] })) };
    },
  );

  app.post(
    '/api/companies/:companyId/roles',
    { preHandler: [guards.requireCompany, guards.requirePermission('users.roles.assign')] },
    async (req: FastifyRequest) => {
      const params = req.params as { companyId: string };
      const body = parse(roleUpsert, req.body);
      const code = slugRoleCode(body.name);

      const exists = await db
        .selectFrom('roles')
        .select('id')
        .where('company_id', '=', params.companyId)
        .where('code', '=', code)
        .executeTakeFirst();
      if (exists) throw new HttpError(409, 'EXISTE', 'Ya existe un rol con ese nombre en esta empresa.');

      const role = await db
        .insertInto('roles')
        .values({
          company_id: params.companyId,
          code,
          name: body.name.trim(),
          description: body.description?.trim() ?? null,
          is_system: false,
          is_editable: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await syncRolePermissions(db, role.id, body.permissions);
      invalidateAccess();

      await audit(db, {
        action: 'ROLE_CREATED',
        entityType: 'roles',
        entityId: role.id,
        userId: guards.principal(req).user.id,
        companyId: params.companyId,
        metadata: { code, permissions: body.permissions },
        ...requestMeta(req),
      });

      return { role: { id: role.id, code, name: body.name, description: body.description ?? null, is_system: false, is_editable: true, active: true, company_id: params.companyId, permissions: body.permissions } };
    },
  );

  app.put(
    '/api/companies/:companyId/roles/:roleId',
    { preHandler: [guards.requireCompany, guards.requirePermission('users.roles.assign')] },
    async (req: FastifyRequest) => {
      const params = req.params as { companyId: string; roleId: string };
      const body = parse(roleUpsert, req.body);

      const role = await db
        .selectFrom('roles')
        .select(['id', 'company_id', 'code', 'is_system', 'is_editable'])
        .where('id', '=', params.roleId)
        .executeTakeFirst();
      if (!role) throw new HttpError(404, 'NO_ENCONTRADO', 'Rol no encontrado.');
      if (role.company_id !== null && role.company_id !== params.companyId) {
        throw new HttpError(403, 'SIN_ACCESO', 'El rol pertenece a otra empresa.');
      }
      if (!role.is_editable) {
        throw new HttpError(403, 'ROL_NO_EDITABLE', 'El rol del sistema no se puede modificar.');
      }

      await db
        .updateTable('roles')
        .set({ name: body.name.trim(), description: body.description?.trim() ?? null })
        .where('id', '=', role.id)
        .execute();
      await syncRolePermissions(db, role.id, body.permissions);
      invalidateAccess();

      await audit(db, {
        action: 'ROLE_UPDATED',
        entityType: 'roles',
        entityId: role.id,
        userId: guards.principal(req).user.id,
        companyId: params.companyId,
        metadata: { permissions: body.permissions },
        ...requestMeta(req),
      });
      return { ok: true };
    },
  );

  /* ---------------------------------------------------------------- */
  /* Asignación de roles por membership                                */
  /* ---------------------------------------------------------------- */

  app.post(
    '/api/companies/:companyId/users/:userId/roles/:roleId',
    { preHandler: [guards.requireCompany] },
    async (req: FastifyRequest) => {
      const params = req.params as { companyId: string; userId: string; roleId: string };
      const actor = guards.principal(req).user;
      const access = req.companyAccess;
      if (!access) throw new HttpError(403, 'SIN_ACCESO', 'No tienes acceso a esta empresa.');

      const role = await db
        .selectFrom('roles')
        .select(['id', 'code', 'company_id', 'active'])
        .where('id', '=', params.roleId)
        .executeTakeFirst();
      if (!role || !role.active) throw new HttpError(404, 'NO_ENCONTRADO', 'Rol no encontrado.');
      if (role.company_id !== null && role.company_id !== params.companyId) {
        throw new HttpError(403, 'SIN_ACCESO', 'El rol pertenece a otra empresa.');
      }

      // Escalamiento de privilegios: asignar OWNER exige permiso propio.
      if (role.code === 'OWNER' && !hasPermission(access, 'users.roles.assign_owner')) {
        throw new HttpError(403, 'PERMISO_INSUFICIENTE', 'Se requiere el permiso "users.roles.assign_owner" para asignar OWNER.');
      }
      if (!hasPermission(access, 'users.roles.assign')) {
        throw new HttpError(403, 'PERMISO_INSUFICIENTE', 'No tienes el permiso "users.roles.assign".');
      }

      const membership = await db
        .selectFrom('company_memberships')
        .select(['id', 'status'])
        .where('user_id', '=', params.userId)
        .where('company_id', '=', params.companyId)
        .executeTakeFirst();
      if (!membership || membership.status !== 'ACTIVE') {
        throw new HttpError(403, 'SIN_ACCESO', 'El usuario no tiene membresía activa en esta empresa.');
      }

      const existing = await db
        .selectFrom('membership_roles')
        .select(['membership_id', 'role_id'])
        .where('membership_id', '=', membership.id)
        .where('role_id', '=', role.id)
        .executeTakeFirst();
      if (!existing) {
        await db.insertInto('membership_roles').values({ membership_id: membership.id, role_id: role.id }).execute();
        await audit(db, {
          action: 'ROLE_ASSIGNED',
          entityType: 'membership_roles',
          entityId: membership.id,
          userId: actor.id,
          targetUserId: params.userId,
          companyId: params.companyId,
          metadata: { role_code: role.code },
          ...requestMeta(req),
        });
        invalidateAccess(params.userId);
      }
      return { ok: true };
    },
  );

  app.delete(
    '/api/companies/:companyId/users/:userId/roles/:roleId',
    { preHandler: [guards.requireCompany] },
    async (req: FastifyRequest) => {
      const params = req.params as { companyId: string; userId: string; roleId: string };
      const access = req.companyAccess;
      if (!access) throw new HttpError(403, 'SIN_ACCESO', 'No tienes acceso a esta empresa.');
      if (!hasPermission(access, 'users.roles.remove')) {
        throw new HttpError(403, 'PERMISO_INSUFICIENTE', 'No tienes el permiso "users.roles.remove".');
      }

      const role = await db.selectFrom('roles').select(['id', 'code']).where('id', '=', params.roleId).executeTakeFirst();
      if (!role) throw new HttpError(404, 'NO_ENCONTRADO', 'Rol no encontrado.');

      const membership = await db
        .selectFrom('company_memberships')
        .select(['id', 'status'])
        .where('user_id', '=', params.userId)
        .where('company_id', '=', params.companyId)
        .executeTakeFirst();
      if (membership) {
        if (role.code === 'OWNER') {
          await assertNotLastOwner(params.companyId, params.userId, 'No se puede quitar el rol OWNER al último OWNER.');
        }
        await db.deleteFrom('membership_roles').where('membership_id', '=', membership.id).where('role_id', '=', role.id).execute();
        invalidateAccess(params.userId);
        await audit(db, {
          action: 'ROLE_REMOVED',
          entityType: 'membership_roles',
          entityId: membership.id,
          userId: guards.principal(req).user.id,
          targetUserId: params.userId,
          companyId: params.companyId,
          metadata: { role_code: role.code },
          ...requestMeta(req),
        });
      }
      return { ok: true };
    },
  );

  /* ---------------------------------------------------------------- */
  /* Sesiones                                                          */
  /* ---------------------------------------------------------------- */

  app.get(
    '/api/users/:id/sessions',
    { preHandler: [guards.requireCompany, guards.requirePermission('sessions.read')] },
    async (req: FastifyRequest) => {
      const params = req.params as { id: string };
      const rows = await db
        .selectFrom('user_sessions')
        .select(['id', 'ip', 'user_agent', 'created_at', 'last_used_at', 'expires_at', 'revoked_at', 'last_auth_at'])
        .where('user_id', '=', params.id)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', new Date())
        .orderBy('last_used_at', 'desc')
        .execute();
      return { sessions: rows };
    },
  );

  app.post(
    '/api/users/:id/sessions/:sessionId/revoke',
    { preHandler: [guards.requireCompany, guards.requirePermission('sessions.revoke')] },
    async (req: FastifyRequest) => {
      const params = req.params as { id: string; sessionId: string };
      await db
        .updateTable('user_sessions')
        .set({ revoked_at: new Date(), revoked_reason: 'ADMIN_REVOKED' })
        .where('id', '=', params.sessionId)
        .where('user_id', '=', params.id)
        .execute();
      await audit(db, {
        action: 'SESSION_REVOKED',
        entityType: 'user_sessions',
        entityId: params.sessionId,
        userId: guards.principal(req).user.id,
        targetUserId: params.id,
        ...requestMeta(req),
      });
      return { ok: true };
    },
  );

  app.post(
    '/api/users/:id/sessions/revoke-all',
    { preHandler: [guards.requireCompany, guards.requirePermission('sessions.revoke')] },
    async (req: FastifyRequest) => {
      const params = req.params as { id: string };
      await revokeUserSessions(db, params.id, 'ADMIN_REVOKED_ALL');
      await audit(db, {
        action: 'SESSIONS_REVOKED',
        entityType: 'users',
        entityId: params.id,
        userId: guards.principal(req).user.id,
        targetUserId: params.id,
        ...requestMeta(req),
      });
      return { ok: true };
    },
  );

  /* ---------------------------------------------------------------- */
  /* 2FA (estado real; acciones disponibles en Fase 4)                 */
  /* ---------------------------------------------------------------- */

  app.post(
    '/api/users/:id/mfa/require',
    { preHandler: [guards.requireCompany, guards.requirePermission('users.2fa.require')] },
    async () => {
      throw new HttpError(501, 'MFA_NO_DISPONIBLE', 'La exigencia de 2FA estará disponible en la Fase 4 (MFA TOTP).');
    },
  );

  app.post(
    '/api/users/:id/mfa/reset',
    { preHandler: [guards.requireCompany, guards.requirePermission('users.2fa.reset')] },
    async () => {
      throw new HttpError(501, 'MFA_NO_DISPONIBLE', 'El reset de 2FA estará disponible en la Fase 4 (MFA TOTP).');
    },
  );
}

function slugRoleCode(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug || `ROL_${Date.now()}`;
}

async function syncRolePermissions(
  db: Kysely<Database>,
  roleId: string,
  permissionCodes: string[],
): Promise<void> {
  const unique = [...new Set(permissionCodes)];
  if (unique.length === 0) {
    await db.deleteFrom('role_permissions').where('role_id', '=', roleId).execute();
    return;
  }
  const perms = await db
    .selectFrom('permissions')
    .select(['id', 'code'])
    .where('code', 'in', unique)
    .execute();
  const wanted = new Set(perms.map((p) => p.id));
  if (wanted.size !== unique.length) {
    const missing = unique.filter((code) => !perms.some((p) => p.code === code));
    throw new HttpError(400, 'PERMISO_INVALIDO', `Permisos desconocidos: ${missing.join(', ')}`);
  }
  await db.deleteFrom('role_permissions').where('role_id', '=', roleId).execute();
  if (perms.length > 0) {
    await db
      .insertInto('role_permissions')
      .values(perms.map((p) => ({ role_id: roleId, permission_id: p.id })))
      .execute();
  }
}
