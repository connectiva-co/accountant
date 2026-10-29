import type { Kysely } from 'kysely';
import type { Database, DeterminationStatus, PersonType, TaxRegime } from '../db/schema.js';

export interface TaxEngineCalculationInput {
  companyId: string;
  documentId: string;
  rentaConceptId?: string | null;
  icaConceptId?: string | null;
  conceptOverrides?: Record<string, string>; // tax_type_id or code -> concept_id
  userId?: string | null;
}

export interface TaxDeterminationResult {
  taxTypeId: string;
  taxTypeCode: string;
  taxTypeName: string;
  taxConceptId: string | null;
  taxConceptCode: string | null;
  taxConceptName: string | null;
  taxRuleId: string | null;
  taxableBase: number;
  rate: number;
  amount: number;
  status: DeterminationStatus;
  source: 'ENGINE' | 'MANUAL';
  explanation: string;
  legalReference: string | null;
  profileSnapshot: Record<string, unknown>;
  ruleSnapshot: Record<string, unknown>;
  overrideReason?: string | null;
}

export class TaxEngine {
  /**
   * Determina automáticamente los impuestos y retenciones aplicables para un documento
   * basándose en:
   * 1. Reglas específicas por tercero y tipo de operación (third_party_tax_rules)
   * 2. Configuración global de la empresa por tipo de documento/operación (company_tax_configurations)
   * 3. Reglas tributarias generales y perfil RUT del tercero (tax_rules / third_party_tax_profiles)
   */
  static async determine(
    db: Kysely<Database>,
    input: TaxEngineCalculationInput
  ): Promise<TaxDeterminationResult[]> {
    const { companyId, documentId, rentaConceptId, icaConceptId, conceptOverrides = {}, userId } = input;

    // 1. Obtener documento y terceros (soporta UUID, CUFE/external_uid o folio)
    const isDocUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId);
    let docQuery = db
      .selectFrom('documents')
      .leftJoin('third_parties as issuer', 'issuer.id', 'documents.issuer_id')
      .leftJoin('third_parties as receiver', 'receiver.id', 'documents.receiver_id')
      .leftJoin('document_types as dt', 'dt.id', 'documents.document_type_id')
      .select([
        'documents.id as id',
        'documents.company_id as company_id',
        'documents.direction as direction',
        'documents.issued_at as issued_at',
        'documents.total as total',
        'documents.issuer_id as issuer_id',
        'documents.receiver_id as receiver_id',
        'documents.document_type_id as document_type_id',
        'dt.category as doc_category',
        'issuer.id as issuer_party_id',
        'issuer.tax_id as issuer_tax_id',
        'issuer.legal_name as issuer_name',
        'receiver.id as receiver_party_id',
        'receiver.tax_id as receiver_tax_id',
        'receiver.legal_name as receiver_name',
      ])
      .where('documents.company_id', '=', companyId);

    if (isDocUuid) {
      docQuery = docQuery.where('documents.id', '=', documentId);
    } else {
      docQuery = docQuery.where((eb) =>
        eb.or([
          eb('documents.external_uid', '=', documentId),
          eb('documents.folio', '=', documentId),
        ])
      );
    }
    const document = await docQuery.executeTakeFirst();

    if (!document) {
      throw new Error(`Documento no encontrado o no pertenece a la empresa: ${documentId}`);
    }

    const direction = document.direction ?? 'UNKNOWN';
    const isPurchase = direction === 'RECEIVED';
    const thirdPartyId = isPurchase ? document.issuer_id : document.receiver_id;

    if (!thirdPartyId) {
      throw new Error('El documento no tiene un tercero emisor/receptor asociado para liquidar impuestos.');
    }

    const docDate = document.issued_at ? String(document.issued_at).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const docCategory = (document.doc_category ?? 'INVOICE') as 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'SUPPORT' | 'ALL';

    // Base gravable (total - IVA si existe)
    const vatTax = await db
      .selectFrom('document_taxes')
      .innerJoin('tax_types', 'tax_types.id', 'document_taxes.tax_type_id')
      .select(['document_taxes.taxable_base as base', 'document_taxes.amount as amount'])
      .where('document_taxes.document_id', '=', document.id)
      .where('tax_types.code', '=', 'IVA')
      .executeTakeFirst();

    const total = Number(document.total ?? 0);
    let taxableBase = total;
    if (vatTax) {
      if (vatTax.base && Number(vatTax.base) > 0) {
        taxableBase = Number(vatTax.base);
      } else if (vatTax.amount && Number(vatTax.amount) > 0) {
        taxableBase = Math.max(0, total - Number(vatTax.amount));
      }
    }

    // 2. Obtener perfil tributario vigente del tercero
    const profile = await db
      .selectFrom('third_party_tax_profiles')
      .selectAll()
      .where('third_party_id', '=', thirdPartyId)
      .where('company_id', '=', companyId)
      .where('valid_from', '<=', docDate)
      .where('valid_to', '>=', docDate)
      .orderBy('valid_from', 'desc')
      .executeTakeFirst();

    let responsibilities: Array<{ id: string; code: string; name: string }> = [];
    if (profile) {
      responsibilities = await db
        .selectFrom('third_party_tax_responsibilities as tr')
        .innerJoin('tax_responsibilities as r', 'r.id', 'tr.responsibility_id')
        .select(['r.id', 'r.code', 'r.name'])
        .where('tr.profile_id', '=', profile.id)
        .execute();
    }
    const respIdSet = new Set(responsibilities.map((r) => r.id));

    const profileSnapshot = profile
      ? {
          profile_id: profile.id,
          person_type: profile.person_type,
          tax_regime: profile.tax_regime,
          economic_activity_code: profile.economic_activity_code,
          ica_municipality_code: profile.ica_municipality_code,
          is_declarant_renta: profile.is_declarant_renta,
          responsibilities: responsibilities.map((r) => ({ code: r.code, name: r.name })),
        }
      : {};

    // 3. Reglas específicas por tercero para este tipo de operación
    const thirdPartyRules = await db
      .selectFrom('third_party_tax_rules as tpr')
      .innerJoin('tax_types as tt', 'tt.id', 'tpr.tax_type_id')
      .selectAll('tpr')
      .select(['tt.code as tax_type_code', 'tt.name as tax_type_name'])
      .where('tpr.company_id', '=', companyId)
      .where('tpr.third_party_id', '=', thirdPartyId)
      .where('tpr.operation_type', 'in', [direction as any, 'ALL'])
      .where('tpr.document_category', 'in', [docCategory, 'ALL'])
      .where('tpr.valid_from', '<=', docDate)
      .where('tpr.valid_to', '>=', docDate)
      .execute();

    // 4. Configuraciones globales de la empresa
    const companyConfigs = await db
      .selectFrom('company_tax_configurations as ctc')
      .innerJoin('tax_types as tt', 'tt.id', 'ctc.tax_type_id')
      .selectAll('ctc')
      .select(['tt.code as tax_type_code', 'tt.name as tax_type_name'])
      .where('ctc.company_id', '=', companyId)
      .where('ctc.operation_type', 'in', [direction as any, 'ALL'])
      .where('ctc.document_category', 'in', [docCategory, 'ALL'])
      .execute();

    // Mapa de conceptos seleccionados manualmente / overrides
    const effectiveConcepts = { ...conceptOverrides };
    if (rentaConceptId) effectiveConcepts['RENTA_RETE'] = rentaConceptId;
    if (icaConceptId) effectiveConcepts['ICA_RETE'] = icaConceptId;

    // Obtener catálogo de conceptos
    const allConcepts = await db.selectFrom('tax_concepts').selectAll().execute();
    const conceptMap = new Map(allConcepts.map((c) => [c.id, c]));

    // Tipos de impuestos relevantes a evaluar
    const relevantTaxTypeIds = new Set<string>();
    for (const r of thirdPartyRules) relevantTaxTypeIds.add(r.tax_type_id);
    for (const c of companyConfigs) if (c.is_enabled) relevantTaxTypeIds.add(c.tax_type_id);

    // Si el usuario envió conceptos explícitos (ej. Renta o ICA), agregarlos
    const allTaxTypes = await db.selectFrom('tax_types').selectAll().execute();
    for (const tt of allTaxTypes) {
      if (effectiveConcepts[tt.id] || effectiveConcepts[tt.code]) {
        relevantTaxTypeIds.add(tt.id);
      }
    }

    // Si aún no hay configuración explícita pero se enviaron rentaId/icaId, mantener compatibilidad básica
    if (relevantTaxTypeIds.size === 0) {
      const defaultRenta = allTaxTypes.find((t) => t.code === 'RENTA_RETE');
      const defaultIca = allTaxTypes.find((t) => t.code === 'ICA_RETE');
      if (rentaConceptId && defaultRenta) relevantTaxTypeIds.add(defaultRenta.id);
      if (icaConceptId && defaultIca) relevantTaxTypeIds.add(defaultIca.id);
    }

    const results: TaxDeterminationResult[] = [];

    // Evaluar cada impuesto relevante
    for (const taxTypeId of relevantTaxTypeIds) {
      const taxType = allTaxTypes.find((t) => t.id === taxTypeId);
      if (!taxType) continue;

      // A. ¿Tiene regla específica el tercero?
      const tpRule = thirdPartyRules.find((r) => r.tax_type_id === taxTypeId);
      if (tpRule) {
        if (tpRule.is_exempt) {
          results.push({
            taxTypeId: taxType.id,
            taxTypeCode: taxType.code,
            taxTypeName: taxType.name,
            taxConceptId: tpRule.custom_concept_id ?? null,
            taxConceptCode: tpRule.custom_concept_id ? conceptMap.get(tpRule.custom_concept_id)?.code ?? null : null,
            taxConceptName: tpRule.custom_concept_id ? conceptMap.get(tpRule.custom_concept_id)?.name ?? null : null,
            taxRuleId: null,
            taxableBase,
            rate: 0,
            amount: 0,
            status: 'EXEMPT',
            source: 'ENGINE',
            explanation: tpRule.notes ? `Exento por regla de tercero: ${tpRule.notes}` : 'Tercero configurado como exento para este impuesto y operación.',
            legalReference: 'Parametrización Tercero',
            profileSnapshot,
            ruleSnapshot: { ...tpRule },
          });
          continue;
        }

        if (tpRule.custom_rate !== null && tpRule.custom_rate !== undefined) {
          const ruleRate = Number(tpRule.custom_rate);
          const amount = Math.round(taxableBase * ruleRate);
          const rateDisplay = tpRule.rate_basis === 'PER_MILLE'
            ? `${(ruleRate * 1000).toFixed(2)} ‰`
            : `${(ruleRate * 100).toFixed(2)} %`;

          results.push({
            taxTypeId: taxType.id,
            taxTypeCode: taxType.code,
            taxTypeName: taxType.name,
            taxConceptId: tpRule.custom_concept_id ?? null,
            taxConceptCode: tpRule.custom_concept_id ? conceptMap.get(tpRule.custom_concept_id)?.code ?? null : null,
            taxConceptName: tpRule.custom_concept_id ? conceptMap.get(tpRule.custom_concept_id)?.name ?? null : null,
            taxRuleId: null,
            taxableBase,
            rate: ruleRate,
            amount,
            status: 'CALCULATED',
            source: 'ENGINE',
            explanation: `Tarifa acordada con el tercero (${rateDisplay}). ${tpRule.notes ?? ''}`.trim(),
            legalReference: 'Acuerdo Tercero',
            profileSnapshot,
            ruleSnapshot: { ...tpRule },
          });
          continue;
        }
      }

      // B. ¿Tiene configuración por defecto la empresa?
      const companyConfig = companyConfigs.find((c) => c.tax_type_id === taxTypeId && c.is_enabled);
      if (companyConfig && companyConfig.default_rate !== null && companyConfig.default_rate !== undefined) {
        const minBase = Number(companyConfig.min_base_cop ?? 0);
        if (minBase > 0 && taxableBase < minBase) {
          results.push({
            taxTypeId: taxType.id,
            taxTypeCode: taxType.code,
            taxTypeName: taxType.name,
            taxConceptId: companyConfig.default_concept_id ?? null,
            taxConceptCode: companyConfig.default_concept_id ? conceptMap.get(companyConfig.default_concept_id)?.code ?? null : null,
            taxConceptName: companyConfig.default_concept_id ? conceptMap.get(companyConfig.default_concept_id)?.name ?? null : null,
            taxRuleId: null,
            taxableBase,
            rate: 0,
            amount: 0,
            status: 'NOT_APPLICABLE',
            source: 'ENGINE',
            explanation: `Base gravable ($ ${taxableBase.toLocaleString('es-CO')}) inferior a la base mínima configurada para la empresa ($ ${minBase.toLocaleString('es-CO')}).`,
            legalReference: 'Configuración Empresa',
            profileSnapshot,
            ruleSnapshot: { ...companyConfig },
          });
          continue;
        }

        const configRate = Number(companyConfig.default_rate);
        const amount = Math.round(taxableBase * configRate);
        const rateDisplay = companyConfig.rate_basis === 'PER_MILLE'
          ? `${(configRate * 1000).toFixed(2)} ‰`
          : `${(configRate * 100).toFixed(2)} %`;

        const metadata = (typeof companyConfig.metadata === 'string' ? JSON.parse(companyConfig.metadata) : companyConfig.metadata) as Record<string, any>;
        const labelNote = metadata?.label ? `${metadata.label}: ` : '';

        results.push({
          taxTypeId: taxType.id,
          taxTypeCode: taxType.code,
          taxTypeName: taxType.name,
          taxConceptId: companyConfig.default_concept_id ?? null,
          taxConceptCode: companyConfig.default_concept_id ? conceptMap.get(companyConfig.default_concept_id)?.code ?? null : null,
          taxConceptName: companyConfig.default_concept_id ? conceptMap.get(companyConfig.default_concept_id)?.name ?? null : null,
          taxRuleId: null,
          taxableBase,
          rate: configRate,
          amount,
          status: 'CALCULATED',
          source: 'ENGINE',
          explanation: `${labelNote}Aplicación por defecto de la empresa para ${direction === 'ISSUED' ? 'Ventas' : 'Compras'} (${rateDisplay}).`,
          legalReference: metadata?.note ?? 'Configuración Empresa',
          profileSnapshot,
          ruleSnapshot: { ...companyConfig },
        });
        continue;
      }

      // C. Motor de reglas generales (Estatuto Tributario / RUT)
      const conceptId = effectiveConcepts[taxType.id] ?? effectiveConcepts[taxType.code] ?? companyConfig?.default_concept_id;
      const conceptObj = conceptId ? conceptMap.get(conceptId) : null;

      if (!conceptId) {
        continue;
      }

      if (!profile) {
        results.push({
          taxTypeId: taxType.id,
          taxTypeCode: taxType.code,
          taxTypeName: taxType.name,
          taxConceptId: conceptId,
          taxConceptCode: conceptObj?.code ?? null,
          taxConceptName: conceptObj?.name ?? null,
          taxRuleId: null,
          taxableBase,
          rate: 0,
          amount: 0,
          status: 'MISSING_PROFILE',
          source: 'ENGINE',
          explanation: `El tercero no tiene perfil tributario/RUT registrado para la fecha del documento (${docDate}). Configure el perfil RUT para liquidar.`,
          legalReference: null,
          profileSnapshot,
          ruleSnapshot: {},
        });
        continue;
      }

      const matchingRule = await this.findMatchingRule(db, {
        companyId,
        taxTypeId: taxType.id,
        taxConceptId: conceptId,
        docDate,
        profile,
        respIdSet,
        municipalityCode: taxType.code === 'ICA_RETE' ? profile.ica_municipality_code : null,
      });

      if (!matchingRule) {
        results.push({
          taxTypeId: taxType.id,
          taxTypeCode: taxType.code,
          taxTypeName: taxType.name,
          taxConceptId: conceptId,
          taxConceptCode: conceptObj?.code ?? null,
          taxConceptName: conceptObj?.name ?? null,
          taxRuleId: null,
          taxableBase,
          rate: 0,
          amount: 0,
          status: 'NO_MATCHING_RULE',
          source: 'ENGINE',
          explanation: `No se encontró una regla para ${taxType.name} ("${conceptObj?.name ?? conceptId}") con el perfil del tercero.`,
          legalReference: null,
          profileSnapshot,
          ruleSnapshot: {},
        });
      } else {
        const ruleRate = Number(matchingRule.rate);
        const minBase = Number(matchingRule.min_base_cop ?? 0);

        if (minBase > 0 && taxableBase < minBase) {
          results.push({
            taxTypeId: taxType.id,
            taxTypeCode: taxType.code,
            taxTypeName: taxType.name,
            taxConceptId: conceptId,
            taxConceptCode: conceptObj?.code ?? null,
            taxConceptName: conceptObj?.name ?? null,
            taxRuleId: matchingRule.id,
            taxableBase,
            rate: 0,
            amount: 0,
            status: 'NOT_APPLICABLE',
            source: 'ENGINE',
            explanation: `Base gravable ($ ${taxableBase.toLocaleString('es-CO')}) inferior a la base mínima legal ($ ${minBase.toLocaleString('es-CO')}) según ${matchingRule.legal_reference ?? 'norma aplicable'}.`,
            legalReference: matchingRule.legal_reference,
            profileSnapshot,
            ruleSnapshot: { ...matchingRule },
          });
        } else if (ruleRate === 0) {
          results.push({
            taxTypeId: taxType.id,
            taxTypeCode: taxType.code,
            taxTypeName: taxType.name,
            taxConceptId: conceptId,
            taxConceptCode: conceptObj?.code ?? null,
            taxConceptName: conceptObj?.name ?? null,
            taxRuleId: matchingRule.id,
            taxableBase,
            rate: 0,
            amount: 0,
            status: 'EXEMPT',
            source: 'ENGINE',
            explanation: matchingRule.explanation ?? 'Tercero u operación exenta.',
            legalReference: matchingRule.legal_reference,
            profileSnapshot,
            ruleSnapshot: { ...matchingRule },
          });
        } else {
          const amount = Math.round(taxableBase * ruleRate);
          const rateDisplay = matchingRule.rate_basis === 'PER_MILLE'
            ? `${(ruleRate * 1000).toFixed(2)} ‰`
            : `${(ruleRate * 100).toFixed(2)} %`;

          results.push({
            taxTypeId: taxType.id,
            taxTypeCode: taxType.code,
            taxTypeName: taxType.name,
            taxConceptId: conceptId,
            taxConceptCode: conceptObj?.code ?? null,
            taxConceptName: conceptObj?.name ?? null,
            taxRuleId: matchingRule.id,
            taxableBase,
            rate: ruleRate,
            amount,
            status: 'CALCULATED',
            source: 'ENGINE',
            explanation: matchingRule.explanation ?? `Tarifa de ${rateDisplay} según ${matchingRule.legal_reference ?? 'norma aplicable'}`,
            legalReference: matchingRule.legal_reference,
            profileSnapshot,
            ruleSnapshot: { ...matchingRule },
          });
        }
      }
    }

    // 5. Persistir en document_tax_determinations
    for (const res of results) {
      await db
        .insertInto('document_tax_determinations')
        .values({
          company_id: companyId,
          document_id: document.id,
          tax_type_id: res.taxTypeId,
          tax_concept_id: res.taxConceptId,
          tax_rule_id: res.taxRuleId,
          taxable_base: res.taxableBase,
          rate: res.rate,
          amount: res.amount,
          status: res.status,
          source: res.source,
          profile_snapshot: JSON.stringify(res.profileSnapshot),
          rule_snapshot: JSON.stringify(res.ruleSnapshot),
          explanation: res.explanation,
          calculated_by: userId ?? null,
          calculated_at: new Date(),
        })
        .onConflict((oc) =>
          oc.columns(['document_id', 'tax_type_id']).doUpdateSet({
            tax_concept_id: res.taxConceptId,
            tax_rule_id: res.taxRuleId,
            taxable_base: res.taxableBase,
            rate: res.rate,
            amount: res.amount,
            status: res.status,
            source: res.source,
            profile_snapshot: JSON.stringify(res.profileSnapshot),
            rule_snapshot: JSON.stringify(res.ruleSnapshot),
            explanation: res.explanation,
            override_reason: null,
            override_rate: null,
            override_amount: null,
            calculated_by: userId ?? null,
            calculated_at: new Date(),
          })
        )
        .execute();
    }

    return results;
  }

  /**
   * Sobrescribe manualmente una determinación tributaria con justificación obligatoria y auditoría.
   */
  static async override(
    db: Kysely<Database>,
    input: {
      companyId: string;
      documentId: string;
      taxTypeId: string;
      overrideRate: number;
      overrideAmount: number;
      reason: string;
      userId: string;
    }
  ): Promise<TaxDeterminationResult> {
    const { companyId, documentId, taxTypeId, overrideRate, overrideAmount, reason, userId } = input;

    if (!reason || reason.trim().length < 5) {
      throw new Error('La justificación del ajuste manual es obligatoria y debe tener al menos 5 caracteres.');
    }

    const existing = await db
      .selectFrom('document_tax_determinations')
      .selectAll()
      .where('document_id', '=', documentId)
      .where('tax_type_id', '=', taxTypeId)
      .where('company_id', '=', companyId)
      .executeTakeFirst();

    if (!existing) {
      throw new Error('No existe una determinación tributaria previa para sobrescribir.');
    }

    const updated = await db
      .updateTable('document_tax_determinations')
      .set({
        rate: overrideRate,
        amount: overrideAmount,
        status: 'MANUALLY_OVERRIDDEN',
        source: 'MANUAL',
        override_reason: reason.trim(),
        override_rate: overrideRate,
        override_amount: overrideAmount,
        explanation: `Ajuste manual del contador: "${reason.trim()}". Tarifa anterior: ${existing.rate}, Importe anterior: ${existing.amount}.`,
        calculated_by: userId,
        calculated_at: new Date(),
      })
      .where('id', '=', existing.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    // Registrar en audit_log
    await db
      .insertInto('audit_log')
      .values({
        company_id: companyId,
        actor_user_id: userId,
        action: 'TAX_CALCULATION_OVERRIDDEN',
        entity_type: 'DOCUMENT_TAX_DETERMINATION',
        entity_id: existing.id,
        metadata: JSON.stringify({
          document_id: documentId,
          tax_type_id: taxTypeId,
          original_rate: existing.rate,
          original_amount: existing.amount,
          new_rate: overrideRate,
          new_amount: overrideAmount,
          reason: reason.trim(),
        }),
      })
      .execute();

    const taxType = await db
      .selectFrom('tax_types')
      .select(['code', 'name'])
      .where('id', '=', taxTypeId)
      .executeTakeFirst();

    return {
      taxTypeId,
      taxTypeCode: taxType?.code ?? '',
      taxTypeName: taxType?.name ?? '',
      taxConceptId: updated.tax_concept_id,
      taxConceptCode: null,
      taxConceptName: null,
      taxRuleId: updated.tax_rule_id,
      taxableBase: Number(updated.taxable_base),
      rate: Number(updated.rate),
      amount: Number(updated.amount),
      status: 'MANUALLY_OVERRIDDEN',
      source: 'MANUAL',
      explanation: updated.explanation ?? '',
      legalReference: null,
      profileSnapshot: (typeof updated.profile_snapshot === 'string' ? JSON.parse(updated.profile_snapshot) : updated.profile_snapshot) as Record<string, unknown>,
      ruleSnapshot: (typeof updated.rule_snapshot === 'string' ? JSON.parse(updated.rule_snapshot) : updated.rule_snapshot) as Record<string, unknown>,
      overrideReason: updated.override_reason,
    };
  }

  private static async findMatchingRule(
    db: Kysely<Database>,
    params: {
      companyId: string;
      taxTypeId: string;
      taxConceptId: string;
      docDate: string;
      profile: {
        person_type: PersonType;
        tax_regime: TaxRegime;
        is_declarant_renta: boolean;
        ica_municipality_code: string;
      };
      respIdSet: Set<string>;
      municipalityCode: string | null;
    }
  ) {
    const { companyId, taxTypeId, taxConceptId, docDate, profile, respIdSet, municipalityCode } = params;

    let query = db
      .selectFrom('tax_rules')
      .selectAll()
      .where('tax_type_id', '=', taxTypeId)
      .where('tax_concept_id', '=', taxConceptId)
      .where('enabled', '=', true)
      .where('effective_from', '<=', docDate)
      .where('effective_to', '>=', docDate);

    if (municipalityCode) {
      query = query.where((eb) =>
        eb.or([
          eb('municipality_code', '=', municipalityCode),
          eb('municipality_code', 'is', null),
        ])
      );
    }

    const candidateRules = await query
      .orderBy('priority', 'desc')
      .execute();

    for (const rule of candidateRules) {
      if (rule.company_id && rule.company_id !== companyId) {
        continue;
      }
      if (rule.person_type && rule.person_type !== profile.person_type) {
        continue;
      }
      if (rule.tax_regime && rule.tax_regime !== profile.tax_regime) {
        continue;
      }
      if (rule.is_declarant_renta !== null && rule.is_declarant_renta !== undefined) {
        if (rule.is_declarant_renta !== profile.is_declarant_renta) {
          continue;
        }
      }
      if (rule.required_responsibility_id && !respIdSet.has(rule.required_responsibility_id)) {
        continue;
      }
      if (rule.excluded_responsibility_id && respIdSet.has(rule.excluded_responsibility_id)) {
        continue;
      }

      return rule;
    }

    return null;
  }
}
