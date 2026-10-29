import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import type { Guards } from '../auth/guards.js';
import { currentUser } from '../auth/guards.js';
import { HttpError } from './errors.js';
import { TaxEngine } from '../domain/tax-engine.js';

const parse = <S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> => {
  let val = value;
  if (typeof val === 'string') {
    try {
      val = JSON.parse(val);
    } catch {
      // mantener como string si no es json
    }
  }
  const res = schema.safeParse(val ?? {});
  if (!res.success) {
    throw new HttpError(400, 'INVALIDO', res.error.issues[0]?.message ?? 'Dato inválido.');
  }
  return res.data;
};

const thirdPartyProfileParams = z.object({
  companyId: z.string().uuid().optional(),
  company_id: z.string().uuid().optional(),
  thirdPartyId: z.string().min(1).optional(),
  third_party_id: z.string().min(1).optional(),
}).transform((val) => ({
  companyId: (val.companyId ?? val.company_id)!,
  thirdPartyId: (val.thirdPartyId ?? val.third_party_id)!,
}));

const documentParams = z.object({
  companyId: z.string().min(1).optional(),
  company_id: z.string().min(1).optional(),
  documentId: z.string().min(1).optional(),
  document_id: z.string().min(1).optional(),
}).transform((val) => ({
  companyId: (val.companyId ?? val.company_id)!,
  documentId: (val.documentId ?? val.document_id)!,
}));

const profileUpsertSchema = z.object({
  person_type: z.enum(['NATURAL', 'JURIDICA']).default('JURIDICA'),
  tax_regime: z.enum(['ORDINARIO', 'SIMPLE', 'ESPECIAL', 'NO_RESPONSABLE']).default('ORDINARIO'),
  economic_activity_code: z.string().max(10).optional().nullable(),
  ica_municipality_code: z.string().max(10).default('11001'),
  is_declarant_renta: z.boolean().default(true),
  expense_account: z.string().max(30).optional().nullable(),
  payable_account: z.string().max(30).optional().nullable(),
  responsibility_ids: z.array(z.string().uuid()).default([]),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const calculateBodySchema = z.object({
  renta_concept_id: z.string().uuid().optional().nullable(),
  ica_concept_id: z.string().uuid().optional().nullable(),
  concept_overrides: z.record(z.string()).optional(),
});

const companyTaxConfigSchema = z.object({
  tax_type_id: z.string().uuid(),
  operation_type: z.enum(['ISSUED', 'RECEIVED', 'ALL']).default('ALL'),
  document_category: z.enum(['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'SUPPORT', 'ALL']).default('ALL'),
  is_enabled: z.boolean().default(true),
  default_rate: z.number().min(0).max(1).optional().nullable(),
  rate_basis: z.enum(['PERCENT', 'PER_MILLE']).default('PERCENT'),
  default_concept_id: z.string().uuid().optional().nullable(),
  accounting_account: z.string().max(30).optional().nullable(),
  min_base_cop: z.number().min(0).default(0),
  metadata: z.record(z.unknown()).optional(),
});

const thirdPartyTaxRuleSchema = z.object({
  tax_type_id: z.string().uuid(),
  operation_type: z.enum(['ISSUED', 'RECEIVED', 'ALL']).default('ALL'),
  document_category: z.enum(['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'SUPPORT', 'ALL']).default('ALL'),
  is_exempt: z.boolean().default(false),
  custom_rate: z.number().min(0).max(1).optional().nullable(),
  rate_basis: z.enum(['PERCENT', 'PER_MILLE']).default('PERCENT'),
  custom_concept_id: z.string().uuid().optional().nullable(),
  accounting_account: z.string().max(30).optional().nullable(),
  municipality_code: z.string().max(10).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const overrideBodySchema = z.object({
  tax_type_id: z.string().uuid(),
  override_rate: z.number().min(0).max(1),
  override_amount: z.number().min(0),
  reason: z.string().min(5).max(500),
});

export function registerTaxRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  guards: Guards
): void {
  // 1. Catálogo de conceptos tributarios
  app.get(
    '/api/tax-concepts',
    { preHandler: [guards.requireAuth] },
    async () => {
      const concepts = await db
        .selectFrom('tax_concepts as tc')
        .innerJoin('tax_types as tt', 'tt.id', 'tc.tax_type_id')
        .select([
          'tc.id as id',
          'tc.code as code',
          'tc.name as name',
          'tc.tax_type_id as tax_type_id',
          'tc.description as description',
          'tc.active as active',
          'tt.code as tax_type_code',
          'tt.name as tax_type_name',
        ])
        .where('tc.active', '=', true)
        .orderBy('tc.name', 'asc')
        .execute();

      return { concepts };
    }
  );

  // 2. Catálogo de responsabilidades tributarias (RUT)
  app.get(
    '/api/tax-responsibilities',
    { preHandler: [guards.requireAuth] },
    async () => {
      const responsibilities = await db
        .selectFrom('tax_responsibilities')
        .selectAll()
        .orderBy('name', 'asc')
        .execute();

      return { responsibilities };
    }
  );

  // 3. Consultar perfil tributario de un tercero (soporta UUID o NIT)
  app.get(
    '/api/companies/:companyId/third-parties/:thirdPartyId/tax-profile',
    { preHandler: [guards.requireCompany, guards.requirePermission('tax_profiles.read')] },
    async (req) => {
      const { companyId, thirdPartyId: identifier } = parse(thirdPartyProfileParams, req.params);

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
      let tpQuery = db
        .selectFrom('third_parties')
        .select(['id', 'tax_id', 'legal_name'])
        .where('company_id', '=', companyId);

      if (isUuid) {
        tpQuery = tpQuery.where('id', '=', identifier);
      } else {
        tpQuery = tpQuery.where('tax_id', '=', identifier);
      }
      const tp = await tpQuery.executeTakeFirst();

      if (!tp) {
        return { profile: null, third_party: null };
      }

      const profile = await db
        .selectFrom('third_party_tax_profiles')
        .selectAll()
        .where('company_id', '=', companyId)
        .where('third_party_id', '=', tp.id)
        .orderBy('valid_from', 'desc')
        .executeTakeFirst();

      if (!profile) {
        return { profile: null, third_party: tp };
      }

      const responsibilities = await db
        .selectFrom('third_party_tax_responsibilities as tr')
        .innerJoin('tax_responsibilities as r', 'r.id', 'tr.responsibility_id')
        .select(['r.id', 'r.code', 'r.name', 'r.description'])
        .where('tr.profile_id', '=', profile.id)
        .execute();

      return {
        third_party: tp,
        profile: {
          ...profile,
          responsibilities,
        },
      };
    }
  );

  // 4. Crear o actualizar perfil tributario de un tercero
  app.put(
    '/api/companies/:companyId/third-parties/:thirdPartyId/tax-profile',
    { preHandler: [guards.requireCompany, guards.requirePermission('tax_profiles.write')] },
    async (req) => {
      const { companyId, thirdPartyId: identifier } = parse(thirdPartyProfileParams, req.params);
      const body = parse(profileUpsertSchema, req.body);
      const user = currentUser(req);

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
      let tpQuery = db
        .selectFrom('third_parties')
        .select(['id', 'tax_id', 'legal_name'])
        .where('company_id', '=', companyId);

      if (isUuid) {
        tpQuery = tpQuery.where('id', '=', identifier);
      } else {
        tpQuery = tpQuery.where('tax_id', '=', identifier);
      }
      const thirdParty = await tpQuery.executeTakeFirst();

      if (!thirdParty) {
        // Si el tercero aún no está en third_parties (ej: Consumidor Final 222222222222), crearlo automáticamente
        const createdTp = await db
          .insertInto('third_parties')
          .values({
            company_id: companyId,
            tax_id: identifier,
            legal_name: identifier === '222222222222' ? 'Consumidor Final' : 'Tercero Facturación',
            normalized_name: identifier === '222222222222' ? 'CONSUMIDOR FINAL' : 'TERCERO FACTURACION',
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        const createdProfile = await db
          .insertInto('third_party_tax_profiles')
          .values({
            company_id: companyId,
            third_party_id: createdTp.id,
            person_type: body.person_type,
            tax_regime: body.tax_regime,
            economic_activity_code: body.economic_activity_code ?? null,
            ica_municipality_code: body.ica_municipality_code,
            is_declarant_renta: body.is_declarant_renta,
            expense_account: body.expense_account ?? null,
            payable_account: body.payable_account ?? null,
            valid_from: body.valid_from ?? new Date().toISOString().slice(0, 10),
            valid_to: body.valid_to ?? '9999-12-31',
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        if (body.responsibility_ids.length > 0) {
          await db
            .insertInto('third_party_tax_responsibilities')
            .values(
              body.responsibility_ids.map((rid) => ({
                profile_id: createdProfile.id,
                responsibility_id: rid,
              }))
            )
            .execute();
        }

        const responsibilities = await db
          .selectFrom('third_party_tax_responsibilities as tr')
          .innerJoin('tax_responsibilities as r', 'r.id', 'tr.responsibility_id')
          .select(['r.id', 'r.code', 'r.name', 'r.description'])
          .where('tr.profile_id', '=', createdProfile.id)
          .execute();

        return {
          third_party: createdTp,
          profile: {
            ...createdProfile,
            responsibilities,
          },
        };
      }

      const thirdPartyId = thirdParty.id;

      // Buscar perfil existente
      const existing = await db
        .selectFrom('third_party_tax_profiles')
        .selectAll()
        .where('company_id', '=', companyId)
        .where('third_party_id', '=', thirdPartyId)
        .orderBy('valid_from', 'desc')
        .executeTakeFirst();

      let profileId: string;

      if (existing) {
        profileId = existing.id;
        await db
          .updateTable('third_party_tax_profiles')
          .set({
            person_type: body.person_type,
            tax_regime: body.tax_regime,
            economic_activity_code: body.economic_activity_code ?? null,
            ica_municipality_code: body.ica_municipality_code,
            is_declarant_renta: body.is_declarant_renta,
            expense_account: body.expense_account ?? existing.expense_account,
            payable_account: body.payable_account ?? existing.payable_account,
            valid_from: body.valid_from ?? existing.valid_from,
            valid_to: body.valid_to ?? existing.valid_to,
            updated_at: new Date(),
          })
          .where('id', '=', profileId)
          .execute();
      } else {
        const created = await db
          .insertInto('third_party_tax_profiles')
          .values({
            company_id: companyId,
            third_party_id: thirdPartyId,
            person_type: body.person_type,
            tax_regime: body.tax_regime,
            economic_activity_code: body.economic_activity_code ?? null,
            ica_municipality_code: body.ica_municipality_code,
            is_declarant_renta: body.is_declarant_renta,
            expense_account: body.expense_account ?? null,
            payable_account: body.payable_account ?? null,
            valid_from: body.valid_from ?? new Date().toISOString().slice(0, 10),
            valid_to: body.valid_to ?? '9999-12-31',
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        profileId = created.id;
      }

      // Actualizar responsabilidades
      await db
        .deleteFrom('third_party_tax_responsibilities')
        .where('profile_id', '=', profileId)
        .execute();

      if (body.responsibility_ids.length > 0) {
        await db
          .insertInto('third_party_tax_responsibilities')
          .values(
            body.responsibility_ids.map((rid) => ({
              profile_id: profileId,
              responsibility_id: rid,
            }))
          )
          .execute();
      }

      // Auditoría
      if (user) {
        await db
          .insertInto('audit_log')
          .values({
            company_id: companyId,
            actor_user_id: user.id,
            action: 'TAX_PROFILE_UPDATED',
            entity_type: 'THIRD_PARTY_TAX_PROFILE',
            entity_id: profileId,
            metadata: JSON.stringify({
              third_party_id: thirdPartyId,
              tax_id: thirdParty.tax_id,
              person_type: body.person_type,
              tax_regime: body.tax_regime,
              economic_activity_code: body.economic_activity_code,
              ica_municipality_code: body.ica_municipality_code,
              responsibilities_count: body.responsibility_ids.length,
            }),
          })
          .execute();
      }

      const updatedProfile = await db
        .selectFrom('third_party_tax_profiles')
        .selectAll()
        .where('id', '=', profileId)
        .executeTakeFirstOrThrow();

      const responsibilities = await db
        .selectFrom('third_party_tax_responsibilities as tr')
        .innerJoin('tax_responsibilities as r', 'r.id', 'tr.responsibility_id')
        .select(['r.id', 'r.code', 'r.name', 'r.description'])
        .where('tr.profile_id', '=', profileId)
        .execute();

      return {
        third_party: thirdParty,
        profile: {
          ...updatedProfile,
          responsibilities,
        },
      };
    }
  );

  // 5. Consultar determinaciones tributarias de un documento
  app.get(
    '/api/companies/:companyId/documents/:documentId/tax-determinations',
    { preHandler: [guards.requireCompany, guards.requirePermission('tax_calculations.calculate')] },
    async (req) => {
      const { companyId, documentId } = parse(documentParams, req.params);

      let actualDocId = documentId;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId)) {
        const doc = await db
          .selectFrom('documents')
          .select('id')
          .where('company_id', '=', companyId)
          .where((eb) => eb.or([eb('external_uid', '=', documentId), eb('folio', '=', documentId)]))
          .executeTakeFirst();
        if (doc) actualDocId = doc.id;
      }

      const rows = await db
        .selectFrom('document_tax_determinations as d')
        .innerJoin('tax_types as tt', 'tt.id', 'd.tax_type_id')
        .leftJoin('tax_concepts as tc', 'tc.id', 'd.tax_concept_id')
        .select([
          'd.id as id',
          'd.tax_type_id as tax_type_id',
          'tt.code as tax_type_code',
          'tt.name as tax_type_name',
          'd.tax_concept_id as tax_concept_id',
          'tc.code as tax_concept_code',
          'tc.name as tax_concept_name',
          'd.tax_rule_id as tax_rule_id',
          'd.taxable_base as taxable_base',
          'd.rate as rate',
          'd.amount as amount',
          'd.status as status',
          'd.source as source',
          'd.explanation as explanation',
          'd.override_reason as override_reason',
          'd.override_rate as override_rate',
          'd.override_amount as override_amount',
          'd.profile_snapshot as profile_snapshot',
          'd.rule_snapshot as rule_snapshot',
          'd.calculated_at as calculated_at',
        ])
        .where('d.document_id', '=', actualDocId)
        .where('d.company_id', '=', companyId)
        .execute();

      return {
        determinations: rows.map((r) => ({
          ...r,
          taxable_base: Number(r.taxable_base),
          rate: Number(r.rate),
          amount: Number(r.amount),
          override_rate: r.override_rate ? Number(r.override_rate) : null,
          override_amount: r.override_amount ? Number(r.override_amount) : null,
          profile_snapshot: typeof r.profile_snapshot === 'string' ? JSON.parse(r.profile_snapshot) : r.profile_snapshot,
          rule_snapshot: typeof r.rule_snapshot === 'string' ? JSON.parse(r.rule_snapshot) : r.rule_snapshot,
        })),
      };
    }
  );

  // 6. Liquidar retenciones mediante el motor tributario
  app.post(
    '/api/companies/:companyId/documents/:documentId/tax-determinations/calculate',
    { preHandler: [guards.requireCompany, guards.requirePermission('tax_calculations.calculate')] },
    async (req) => {
      const { companyId, documentId } = parse(documentParams, req.params);
      const body = parse(calculateBodySchema, req.body);
      const user = currentUser(req);

      const results = await TaxEngine.determine(db, {
        companyId,
        documentId,
        rentaConceptId: body.renta_concept_id,
        icaConceptId: body.ica_concept_id,
        conceptOverrides: body.concept_overrides,
        userId: user?.id,
      });

      return { determinations: results };
    }
  );

  // 7. Modificar/sobrescribir retención con justificación contable obligatoria
  app.post(
    '/api/companies/:companyId/documents/:documentId/tax-determinations/override',
    { preHandler: [guards.requireCompany, guards.requirePermission('tax_calculations.override')] },
    async (req) => {
      const { companyId, documentId } = parse(documentParams, req.params);
      const body = parse(overrideBodySchema, req.body);
      const user = currentUser(req);

      if (!user) {
        throw new HttpError(401, 'NO_AUTENTICADO', 'Usuario no autenticado.');
      }

      const result = await TaxEngine.override(db, {
        companyId,
        documentId,
        taxTypeId: body.tax_type_id,
        overrideRate: body.override_rate,
        overrideAmount: body.override_amount,
        reason: body.reason,
        userId: user.id,
      });

      return { determination: result };
    }
  );

  // 8. Consultar configuración tributaria de la empresa
  app.get(
    '/api/companies/:companyId/tax-configurations',
    { preHandler: [guards.requireCompany, guards.requirePermission('tax_rules.read')] },
    async (req) => {
      const { companyId } = parse(z.object({ companyId: z.string().uuid() }), req.params);

      const configs = await db
        .selectFrom('company_tax_configurations as c')
        .innerJoin('tax_types as tt', 'tt.id', 'c.tax_type_id')
        .leftJoin('tax_concepts as tc', 'tc.id', 'c.default_concept_id')
        .select([
          'c.id as id',
          'c.company_id as company_id',
          'c.tax_type_id as tax_type_id',
          'tt.code as tax_type_code',
          'tt.name as tax_type_name',
          'c.operation_type as operation_type',
          'c.document_category as document_category',
          'c.is_enabled as is_enabled',
          'c.default_rate as default_rate',
          'c.rate_basis as rate_basis',
          'c.default_concept_id as default_concept_id',
          'tc.name as default_concept_name',
          'c.accounting_account as accounting_account',
          'c.min_base_cop as min_base_cop',
          'c.metadata as metadata',
          'c.created_at as created_at',
          'c.updated_at as updated_at',
        ])
        .where('c.company_id', '=', companyId)
        .orderBy('tt.name', 'asc')
        .execute();

      return {
        configurations: configs.map((c) => ({
          ...c,
          default_rate: c.default_rate !== null ? Number(c.default_rate) : null,
          min_base_cop: Number(c.min_base_cop),
          metadata: typeof c.metadata === 'string' ? JSON.parse(c.metadata) : c.metadata,
        })),
      };
    }
  );

  // 9. Guardar/actualizar configuración tributaria de la empresa
  app.post(
    '/api/companies/:companyId/tax-configurations',
    { preHandler: [guards.requireCompany, guards.requirePermission('tax_rules.write')] },
    async (req) => {
      const { companyId } = parse(z.object({ companyId: z.string().uuid() }), req.params);
      const body = parse(companyTaxConfigSchema, req.body);

      const saved = await db
        .insertInto('company_tax_configurations')
        .values({
          company_id: companyId,
          tax_type_id: body.tax_type_id,
          operation_type: body.operation_type,
          document_category: body.document_category,
          is_enabled: body.is_enabled,
          default_rate: body.default_rate ?? null,
          rate_basis: body.rate_basis,
          default_concept_id: body.default_concept_id ?? null,
          accounting_account: body.accounting_account ?? null,
          min_base_cop: body.min_base_cop,
          metadata: JSON.stringify(body.metadata ?? {}),
          updated_at: new Date(),
        })
        .onConflict((oc) =>
          oc.columns(['company_id', 'tax_type_id', 'operation_type', 'document_category']).doUpdateSet({
            is_enabled: body.is_enabled,
            default_rate: body.default_rate ?? null,
            rate_basis: body.rate_basis,
            default_concept_id: body.default_concept_id ?? null,
            accounting_account: body.accounting_account ?? null,
            min_base_cop: body.min_base_cop,
            metadata: JSON.stringify(body.metadata ?? {}),
            updated_at: new Date(),
          })
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        configuration: {
          ...saved,
          default_rate: saved.default_rate !== null ? Number(saved.default_rate) : null,
          min_base_cop: Number(saved.min_base_cop),
          metadata: typeof saved.metadata === 'string' ? JSON.parse(saved.metadata) : saved.metadata,
        },
      };
    }
  );

  // 10. Eliminar configuración tributaria de la empresa
  app.delete(
    '/api/companies/:companyId/tax-configurations/:id',
    { preHandler: [guards.requireCompany, guards.requirePermission('tax_rules.write')] },
    async (req) => {
      const { companyId, id } = parse(z.object({ companyId: z.string().uuid(), id: z.string().uuid() }), req.params);
      await db
        .deleteFrom('company_tax_configurations')
        .where('id', '=', id)
        .where('company_id', '=', companyId)
        .execute();
      return { success: true };
    }
  );

  // 11. Consultar reglas específicas de un tercero
  app.get(
    '/api/companies/:companyId/third-parties/:thirdPartyId/tax-rules',
    { preHandler: [guards.requireCompany, guards.requirePermission('tax_rules.read')] },
    async (req) => {
      const { companyId, thirdPartyId } = parse(thirdPartyProfileParams, req.params);

      // Resolver ID si viene por tax_id
      let actualPartyId = thirdPartyId;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(thirdPartyId)) {
        const tp = await db
          .selectFrom('third_parties')
          .select('id')
          .where('company_id', '=', companyId)
          .where('tax_id', '=', thirdPartyId)
          .executeTakeFirst();
        if (tp) actualPartyId = tp.id;
      }

      const rules = await db
        .selectFrom('third_party_tax_rules as r')
        .innerJoin('tax_types as tt', 'tt.id', 'r.tax_type_id')
        .leftJoin('tax_concepts as tc', 'tc.id', 'r.custom_concept_id')
        .select([
          'r.id as id',
          'r.company_id as company_id',
          'r.third_party_id as third_party_id',
          'r.tax_type_id as tax_type_id',
          'tt.code as tax_type_code',
          'tt.name as tax_type_name',
          'r.operation_type as operation_type',
          'r.document_category as document_category',
          'r.is_exempt as is_exempt',
          'r.custom_rate as custom_rate',
          'r.rate_basis as rate_basis',
          'r.custom_concept_id as custom_concept_id',
          'tc.name as custom_concept_name',
          'r.accounting_account as accounting_account',
          'r.municipality_code as municipality_code',
          'r.notes as notes',
          'r.valid_from as valid_from',
          'r.valid_to as valid_to',
          'r.created_at as created_at',
          'r.updated_at as updated_at',
        ])
        .where('r.company_id', '=', companyId)
        .where('r.third_party_id', '=', actualPartyId)
        .orderBy('tt.name', 'asc')
        .execute();

      return {
        rules: rules.map((r) => ({
          ...r,
          custom_rate: r.custom_rate !== null ? Number(r.custom_rate) : null,
        })),
      };
    }
  );

  // 12. Guardar/actualizar regla específica de un tercero
  app.post(
    '/api/companies/:companyId/third-parties/:thirdPartyId/tax-rules',
    { preHandler: [guards.requireCompany, guards.requirePermission('tax_rules.write')] },
    async (req) => {
      const { companyId, thirdPartyId } = parse(thirdPartyProfileParams, req.params);
      const body = parse(thirdPartyTaxRuleSchema, req.body);

      let actualPartyId = thirdPartyId;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(thirdPartyId)) {
        const tp = await db
          .selectFrom('third_parties')
          .select('id')
          .where('company_id', '=', companyId)
          .where('tax_id', '=', thirdPartyId)
          .executeTakeFirst();
        if (tp) actualPartyId = tp.id;
      }

      const saved = await db
        .insertInto('third_party_tax_rules')
        .values({
          company_id: companyId,
          third_party_id: actualPartyId,
          tax_type_id: body.tax_type_id,
          operation_type: body.operation_type,
          document_category: body.document_category,
          is_exempt: body.is_exempt,
          custom_rate: body.custom_rate ?? null,
          rate_basis: body.rate_basis,
          custom_concept_id: body.custom_concept_id ?? null,
          accounting_account: body.accounting_account ?? null,
          municipality_code: body.municipality_code ?? null,
          notes: body.notes ?? null,
          valid_from: body.valid_from ?? new Date().toISOString().slice(0, 10),
          valid_to: body.valid_to ?? '9999-12-31',
          updated_at: new Date(),
        })
        .onConflict((oc) =>
          oc.columns(['company_id', 'third_party_id', 'tax_type_id', 'operation_type', 'document_category']).doUpdateSet({
            is_exempt: body.is_exempt,
            custom_rate: body.custom_rate ?? null,
            rate_basis: body.rate_basis,
            custom_concept_id: body.custom_concept_id ?? null,
            accounting_account: body.accounting_account ?? null,
            municipality_code: body.municipality_code ?? null,
            notes: body.notes ?? null,
            valid_from: body.valid_from ?? new Date().toISOString().slice(0, 10),
            valid_to: body.valid_to ?? '9999-12-31',
            updated_at: new Date(),
          })
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        rule: {
          ...saved,
          custom_rate: saved.custom_rate !== null ? Number(saved.custom_rate) : null,
        },
      };
    }
  );

  // 13. Eliminar regla específica de un tercero
  app.delete(
    '/api/companies/:companyId/third-parties/:thirdPartyId/tax-rules/:id',
    { preHandler: [guards.requireCompany, guards.requirePermission('tax_rules.write')] },
    async (req) => {
      const { companyId, id } = parse(z.object({ companyId: z.string().uuid(), id: z.string().uuid() }), req.params);
      await db
        .deleteFrom('third_party_tax_rules')
        .where('id', '=', id)
        .where('company_id', '=', companyId)
        .execute();
      return { success: true };
    }
  );
}
