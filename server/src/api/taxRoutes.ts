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
  responsibility_ids: z.array(z.string().uuid()).default([]),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const calculateBodySchema = z.object({
  renta_concept_id: z.string().uuid().optional().nullable(),
  ica_concept_id: z.string().uuid().optional().nullable(),
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
}
