-- 0008_tax_engine.sql: Motor de determinación tributaria parametrizable (ReteFuente, ReteICA, ReteIVA)

-- 1. Actualizar catálogo de acciones en audit_log
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check
  CHECK (action IN (
    'INSERT', 'UPDATE', 'DELETE', 'RESOLVE', 'IMPORT', 'LOGIN', 'SETTINGS',
    'INTEGRATION_CREATED', 'INTEGRATION_ENABLED', 'INTEGRATION_DISABLED',
    'INTEGRATION_SETTINGS_UPDATED', 'INTEGRATION_CREDENTIALS_UPDATED',
    'INTEGRATION_CONNECTION_TESTED', 'SYNC_RUN',
    'USER_CREATED', 'USER_INVITED', 'USER_UPDATED', 'USER_DISABLED',
    'USER_REACTIVATED', 'MEMBERSHIP_CREATED', 'MEMBERSHIP_DISABLED',
    'MEMBERSHIP_REACTIVATED', 'ROLE_ASSIGNED', 'ROLE_REMOVED',
    'ROLE_CREATED', 'ROLE_UPDATED',
    'PASSWORD_RESET_REQUESTED', 'PASSWORD_CHANGED', 'MFA_REQUIRED',
    'MFA_RESET', 'MFA_VERIFIED', 'SESSION_REVOKED', 'SESSIONS_REVOKED',
    'COMPANY_IDENTITY_UPDATED',
    'TAX_CALCULATION_DETERMINED', 'TAX_CALCULATION_OVERRIDDEN', 'TAX_PROFILE_UPDATED'
  ));

-- 2. Permisos RBAC para perfiles y cálculo de retenciones
INSERT INTO permissions (code, name, description, category, risk_level, requires_step_up) VALUES
  ('tax_profiles.read',          'Ver perfiles tributarios',       'Consultar el perfil RUT/tributario de terceros',         'IMPUESTOS',   'LOW',    false),
  ('tax_profiles.write',         'Editar perfiles tributarios',    'Crear o actualizar perfiles RUT y responsabilidades',    'IMPUESTOS',   'MEDIUM', false),
  ('tax_rules.read',             'Ver reglas tributarias',         'Consultar catálogo de conceptos y reglas tributarias',   'IMPUESTOS',   'LOW',    false),
  ('tax_rules.write',            'Editar reglas tributarias',      'Parametrizar reglas y tarifas tributarias',              'IMPUESTOS',   'HIGH',   false),
  ('tax_calculations.calculate', 'Liquidar retenciones',           'Ejecutar cálculo del motor tributario sobre facturas',   'IMPUESTOS',   'LOW',    false),
  ('tax_calculations.override',  'Modificar retención liquidada',  'Sobrescribir manualmente tarifa o importe de retención', 'IMPUESTOS',   'HIGH',   false)
ON CONFLICT (code) DO NOTHING;

-- Asignar permisos a roles OWNER, ADMIN y CONTADOR
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('OWNER', 'ADMIN', 'CONTADOR')
  AND p.code IN (
    'tax_profiles.read', 'tax_profiles.write',
    'tax_rules.read', 'tax_rules.write',
    'tax_calculations.calculate', 'tax_calculations.override'
  )
ON CONFLICT DO NOTHING;

-- Asignar lectura a AUDITOR
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'AUDITOR'
  AND p.code IN ('tax_profiles.read', 'tax_rules.read', 'tax_calculations.calculate')
ON CONFLICT DO NOTHING;

-- 3. Catálogo de responsabilidades tributarias (RUT DIAN)
CREATE TABLE IF NOT EXISTS tax_responsibilities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        varchar(50) NOT NULL UNIQUE,
  name        varchar(128) NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 4. Catálogo de conceptos u operaciones tributarias
CREATE TABLE IF NOT EXISTS tax_concepts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        varchar(64) NOT NULL UNIQUE,
  name        varchar(150) NOT NULL,
  tax_type_id uuid NOT NULL REFERENCES tax_types(id),
  description text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tax_concepts_tax_type_idx ON tax_concepts(tax_type_id);

-- 5. Perfiles tributarios de terceros (vigencia histórica)
CREATE TABLE IF NOT EXISTS third_party_tax_profiles (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES companies(id),
  third_party_id           uuid NOT NULL REFERENCES third_parties(id),
  person_type              varchar(20) NOT NULL DEFAULT 'JURIDICA' CHECK (person_type IN ('NATURAL', 'JURIDICA')),
  tax_regime               varchar(30) NOT NULL DEFAULT 'ORDINARIO' CHECK (tax_regime IN ('ORDINARIO', 'SIMPLE', 'ESPECIAL', 'NO_RESPONSABLE')),
  economic_activity_code   varchar(10),
  ica_municipality_code    varchar(10) NOT NULL DEFAULT '11001',
  is_declarant_renta       boolean NOT NULL DEFAULT true,
  valid_from               date NOT NULL DEFAULT CURRENT_DATE,
  valid_to                 date NOT NULL DEFAULT '9999-12-31',
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tp_tax_profiles_dates_check CHECK (valid_from <= valid_to)
);

CREATE INDEX IF NOT EXISTS tp_tax_profiles_lookup_idx
  ON third_party_tax_profiles (third_party_id, valid_from, valid_to);

-- 6. Responsabilidades del tercero según su RUT
CREATE TABLE IF NOT EXISTS third_party_tax_responsibilities (
  profile_id        uuid NOT NULL REFERENCES third_party_tax_profiles(id) ON DELETE CASCADE,
  responsibility_id uuid NOT NULL REFERENCES tax_responsibilities(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, responsibility_id)
);

-- 7. Motor de reglas parametrizables
CREATE TABLE IF NOT EXISTS tax_rules (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 uuid REFERENCES companies(id),
  tax_type_id                uuid NOT NULL REFERENCES tax_types(id),
  tax_concept_id             uuid NOT NULL REFERENCES tax_concepts(id),
  municipality_code          varchar(10),
  person_type                varchar(20) CHECK (person_type IN ('NATURAL', 'JURIDICA')),
  is_declarant_renta         boolean,
  tax_regime                 varchar(30) CHECK (tax_regime IN ('ORDINARIO', 'SIMPLE', 'ESPECIAL', 'NO_RESPONSABLE')),
  required_responsibility_id uuid REFERENCES tax_responsibilities(id),
  excluded_responsibility_id uuid REFERENCES tax_responsibilities(id),
  min_base_cop               numeric(20,2) NOT NULL DEFAULT 0,
  rate                       numeric(10,6) NOT NULL,
  rate_basis                 varchar(10) NOT NULL DEFAULT 'PERCENT' CHECK (rate_basis IN ('PERCENT', 'PER_MILLE')),
  effective_from             date NOT NULL DEFAULT '2024-01-01',
  effective_to               date NOT NULL DEFAULT '9999-12-31',
  priority                   integer NOT NULL DEFAULT 100,
  legal_reference            varchar(255),
  explanation                text,
  enabled                    boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_rules_dates_check CHECK (effective_from <= effective_to)
);

CREATE INDEX IF NOT EXISTS tax_rules_eval_idx
  ON tax_rules (tax_type_id, tax_concept_id, enabled, priority DESC);

-- 8. Determinaciones tributarias calculadas por documento
CREATE TABLE IF NOT EXISTS document_tax_determinations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  document_id      uuid NOT NULL REFERENCES documents(id),
  tax_type_id      uuid NOT NULL REFERENCES tax_types(id),
  tax_concept_id   uuid REFERENCES tax_concepts(id),
  tax_rule_id      uuid REFERENCES tax_rules(id),
  taxable_base     numeric(20,2) NOT NULL DEFAULT 0,
  rate             numeric(10,6) NOT NULL DEFAULT 0,
  amount           numeric(20,2) NOT NULL DEFAULT 0,
  status           varchar(30) NOT NULL CHECK (
    status IN (
      'CALCULATED',
      'EXEMPT',
      'NOT_APPLICABLE',
      'MISSING_PROFILE',
      'NO_MATCHING_RULE',
      'REQUIRES_REVIEW',
      'MANUALLY_OVERRIDDEN'
    )
  ),
  source           varchar(30) NOT NULL DEFAULT 'ENGINE' CHECK (source IN ('ENGINE', 'MANUAL')),
  profile_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  rule_snapshot    jsonb NOT NULL DEFAULT '{}'::jsonb,
  explanation      text,
  override_reason  text,
  override_rate    numeric(10,6),
  override_amount  numeric(20,2),
  calculated_by    uuid REFERENCES users(id),
  calculated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT doc_tax_det_doc_tax_unique UNIQUE (document_id, tax_type_id)
);

CREATE INDEX IF NOT EXISTS doc_tax_det_doc_idx ON document_tax_determinations (document_id);
CREATE INDEX IF NOT EXISTS doc_tax_det_comp_idx ON document_tax_determinations (company_id);

-- 9. Datos Semilla: Responsabilidades tributarias
INSERT INTO tax_responsibilities (code, name, description) VALUES
  ('REGIMEN_SIMPLE',        'Régimen Simple de Tributación (RST)',       'Sujeto pasivo del RST. No sujeto a retención en la fuente por renta ni ICA (Art. 911 E.T.)'),
  ('AUTORRETENEDOR_RENTA',  'Autorretenedor en Renta',                   'Contribuyente autorizado para autorretenerse en impuesto de renta'),
  ('AUTORRETENEDOR_ICA',    'Autorretenedor en ICA',                     'Contribuyente con resolución municipal de autorretención de ICA'),
  ('GRAN_CONTRIBUYENTE',    'Gran Contribuyente',                        'Calificado por la DIAN como Gran Contribuyente'),
  ('RESPONSABLE_IVA',       'Responsable de IVA',                        'Persona jurídica o natural responsable del impuesto sobre las ventas'),
  ('NO_RESPONSABLE_IVA',    'No Responsable de IVA',                     'Persona natural no responsable de IVA (antiguo simplificado)')
ON CONFLICT (code) DO NOTHING;

-- 10. Datos Semilla: Conceptos Tributarios (ReteFuente & ReteICA)
DO $$
DECLARE
  v_renta_id uuid;
  v_ica_id   uuid;
BEGIN
  SELECT id INTO v_renta_id FROM tax_types WHERE code = 'RENTA_RETE';
  SELECT id INTO v_ica_id   FROM tax_types WHERE code = 'ICA_RETE';

  IF v_renta_id IS NOT NULL THEN
    INSERT INTO tax_concepts (code, name, tax_type_id, description) VALUES
      ('COMPRAS_GENERAL',        'Compras generales',                                v_renta_id, 'Adquisición de bienes, insumos y mercancías'),
      ('SERVICIOS_GENERAL',      'Servicios generales',                              v_renta_id, 'Prestación de servicios operativos y generales'),
      ('SERVICIOS_TECNICOS',     'Servicios técnicos y especializados',              v_renta_id, 'Mantenimiento, tecnología y soporte especializado'),
      ('HONORARIOS_JURIDICA',    'Honorarios y consultoría (Persona Jurídica)',      v_renta_id, 'Servicios profesionales prestados por personas jurídicas'),
      ('HONORARIOS_NATURAL',     'Honorarios y consultoría (Persona Natural)',       v_renta_id, 'Servicios profesionales prestados por personas naturales'),
      ('ARRENDAMIENTO_MUEBLES',  'Arrendamiento de bienes muebles',                  v_renta_id, 'Alquiler de maquinaria, equipos, vehículos'),
      ('ARRENDAMIENTO_INMUEBLE', 'Arrendamiento de bienes raíces',                  v_renta_id, 'Alquiler de locales comerciales, bodegas u oficinas'),
      ('TRANSPORTE_CARGA',       'Transporte de carga terrestre',                    v_renta_id, 'Servicio de flete y transporte de mercancías'),
      ('COMISIONES_MERCANTILES', 'Comisiones mercantiles',                           v_renta_id, 'Intermediación y corretaje comercial')
    ON CONFLICT (code) DO NOTHING;
  END IF;

  IF v_ica_id IS NOT NULL THEN
    INSERT INTO tax_concepts (code, name, tax_type_id, description) VALUES
      ('ICA_COMPRAS_BOGOTA',     'ICA Compras comerciales (Bogotá)',                 v_ica_id,   'Actividades comerciales de compraventa en Bogotá D.C.'),
      ('ICA_SERVICIOS_BOGOTA',   'ICA Servicios generales (Bogotá)',                 v_ica_id,   'Servicios y contratos operativos en Bogotá D.C.'),
      ('ICA_HONORARIOS_BOGOTA',  'ICA Honorarios y consultoría (Bogotá)',            v_ica_id,   'Actividades profesionales y de consultoría en Bogotá D.C.')
    ON CONFLICT (code) DO NOTHING;
  END IF;
END $$;

-- 11. Datos Semilla: Reglas Base Nacionales y Distritales
DO $$
DECLARE
  v_renta_id       uuid;
  v_ica_id         uuid;
  v_rst_id         uuid;
  v_auto_renta_id  uuid;
  v_auto_ica_id    uuid;
  v_c_compras      uuid;
  v_c_servicios    uuid;
  v_c_serv_tec     uuid;
  v_c_hon_jur      uuid;
  v_c_hon_nat      uuid;
  v_c_arr_mue      uuid;
  v_c_arr_inm      uuid;
  v_c_ica_comp     uuid;
  v_c_ica_serv     uuid;
  v_c_ica_hon      uuid;
BEGIN
  SELECT id INTO v_renta_id FROM tax_types WHERE code = 'RENTA_RETE';
  SELECT id INTO v_ica_id   FROM tax_types WHERE code = 'ICA_RETE';

  SELECT id INTO v_rst_id        FROM tax_responsibilities WHERE code = 'REGIMEN_SIMPLE';
  SELECT id INTO v_auto_renta_id FROM tax_responsibilities WHERE code = 'AUTORRETENEDOR_RENTA';
  SELECT id INTO v_auto_ica_id   FROM tax_responsibilities WHERE code = 'AUTORRETENEDOR_ICA';

  SELECT id INTO v_c_compras   FROM tax_concepts WHERE code = 'COMPRAS_GENERAL';
  SELECT id INTO v_c_servicios FROM tax_concepts WHERE code = 'SERVICIOS_GENERAL';
  SELECT id INTO v_c_serv_tec  FROM tax_concepts WHERE code = 'SERVICIOS_TECNICOS';
  SELECT id INTO v_c_hon_jur   FROM tax_concepts WHERE code = 'HONORARIOS_JURIDICA';
  SELECT id INTO v_c_hon_nat   FROM tax_concepts WHERE code = 'HONORARIOS_NATURAL';
  SELECT id INTO v_c_arr_mue   FROM tax_concepts WHERE code = 'ARRENDAMIENTO_MUEBLES';
  SELECT id INTO v_c_arr_inm   FROM tax_concepts WHERE code = 'ARRENDAMIENTO_INMUEBLE';

  SELECT id INTO v_c_ica_comp  FROM tax_concepts WHERE code = 'ICA_COMPRAS_BOGOTA';
  SELECT id INTO v_c_ica_serv  FROM tax_concepts WHERE code = 'ICA_SERVICIOS_BOGOTA';
  SELECT id INTO v_c_ica_hon   FROM tax_concepts WHERE code = 'ICA_HONORARIOS_BOGOTA';

  -- Regla de exención ReteFuente: Proveedor Régimen Simple
  IF v_c_compras IS NOT NULL AND v_rst_id IS NOT NULL THEN
    INSERT INTO tax_rules (
      tax_type_id, tax_concept_id, required_responsibility_id,
      rate, rate_basis, priority, legal_reference, explanation
    ) VALUES (
      v_renta_id, v_c_compras, v_rst_id,
      0.000000, 'PERCENT', 900, 'E.T. Art. 911',
      'Exento de ReteFuente por pertenecer al Régimen Simple de Tributación (RST)'
    );
  END IF;

  -- Regla de exención ReteFuente: Proveedor Autorretenedor
  IF v_c_compras IS NOT NULL AND v_auto_renta_id IS NOT NULL THEN
    INSERT INTO tax_rules (
      tax_type_id, tax_concept_id, required_responsibility_id,
      rate, rate_basis, priority, legal_reference, explanation
    ) VALUES (
      v_renta_id, v_c_compras, v_auto_renta_id,
      0.000000, 'PERCENT', 850, 'E.T. Art. 365 / Resol. DIAN',
      'No sujeto a retención: El proveedor es Autorretenedor en Renta'
    );
  END IF;

  -- Compras Generales - Declarante (2.5%)
  IF v_c_compras IS NOT NULL THEN
    INSERT INTO tax_rules (
      tax_type_id, tax_concept_id, is_declarant_renta,
      rate, rate_basis, priority, legal_reference, explanation
    ) VALUES (
      v_renta_id, v_c_compras, true,
      0.025000, 'PERCENT', 100, 'E.T. Art. 392 / D.R. 2418/2013',
      'Retención en la fuente del 2.5% para compras a declarantes de renta'
    );

    -- Compras Generales - No Declarante (3.5%)
    INSERT INTO tax_rules (
      tax_type_id, tax_concept_id, is_declarant_renta,
      rate, rate_basis, priority, legal_reference, explanation
    ) VALUES (
      v_renta_id, v_c_compras, false,
      0.035000, 'PERCENT', 100, 'E.T. Art. 392 / D.R. 2418/2013',
      'Retención en la fuente del 3.5% para compras a no declarantes'
    );
  END IF;

  -- Servicios Generales - Declarante (4%)
  IF v_c_servicios IS NOT NULL THEN
    INSERT INTO tax_rules (
      tax_type_id, tax_concept_id, is_declarant_renta,
      rate, rate_basis, priority, legal_reference, explanation
    ) VALUES (
      v_renta_id, v_c_servicios, true,
      0.040000, 'PERCENT', 100, 'E.T. Art. 392',
      'Retención en la fuente del 4% para servicios a declarantes'
    );

    -- Servicios Generales - No Declarante (6%)
    INSERT INTO tax_rules (
      tax_type_id, tax_concept_id, is_declarant_renta,
      rate, rate_basis, priority, legal_reference, explanation
    ) VALUES (
      v_renta_id, v_c_servicios, false,
      0.060000, 'PERCENT', 100, 'E.T. Art. 392',
      'Retención en la fuente del 6% para servicios a no declarantes'
    );
  END IF;

  -- Servicios Técnicos / Especializados (4%)
  IF v_c_serv_tec IS NOT NULL THEN
    INSERT INTO tax_rules (
      tax_type_id, tax_concept_id,
      rate, rate_basis, priority, legal_reference, explanation
    ) VALUES (
      v_renta_id, v_c_serv_tec,
      0.040000, 'PERCENT', 100, 'E.T. Art. 392 inc. 3',
      'Retención en la fuente del 4% para servicios técnicos y especializados'
    );
  END IF;

  -- Honorarios Persona Jurídica (11%)
  IF v_c_hon_jur IS NOT NULL THEN
    INSERT INTO tax_rules (
      tax_type_id, tax_concept_id, person_type,
      rate, rate_basis, priority, legal_reference, explanation
    ) VALUES (
      v_renta_id, v_c_hon_jur, 'JURIDICA',
      0.110000, 'PERCENT', 100, 'E.T. Art. 392 / D.R. 260 de 2001',
      'Retención del 11% sobre honorarios y consultoría a Personas Jurídicas'
    );
  END IF;

  -- Honorarios Persona Natural Declarante (11%)
  IF v_c_hon_nat IS NOT NULL THEN
    INSERT INTO tax_rules (
      tax_type_id, tax_concept_id, person_type, is_declarant_renta,
      rate, rate_basis, priority, legal_reference, explanation
    ) VALUES (
      v_renta_id, v_c_hon_nat, 'NATURAL', true,
      0.110000, 'PERCENT', 100, 'E.T. Art. 392',
      'Retención del 11% sobre honorarios a Persona Natural declarante'
    );

    -- Honorarios Persona Natural No Declarante (10%)
    INSERT INTO tax_rules (
      tax_type_id, tax_concept_id, person_type, is_declarant_renta,
      rate, rate_basis, priority, legal_reference, explanation
    ) VALUES (
      v_renta_id, v_c_hon_nat, 'NATURAL', false,
      0.100000, 'PERCENT', 100, 'E.T. Art. 392',
      'Retención del 10% sobre honorarios a Persona Natural no declarante'
    );
  END IF;

  -- Arrendamientos
  IF v_c_arr_mue IS NOT NULL THEN
    INSERT INTO tax_rules (
      tax_type_id, tax_concept_id,
      rate, rate_basis, priority, legal_reference, explanation
    ) VALUES (
      v_renta_id, v_c_arr_mue,
      0.040000, 'PERCENT', 100, 'E.T. Art. 401',
      'Retención del 4% sobre arrendamiento de bienes muebles y maquinaria'
    );
  END IF;

  IF v_c_arr_inm IS NOT NULL THEN
    INSERT INTO tax_rules (
      tax_type_id, tax_concept_id,
      rate, rate_basis, priority, legal_reference, explanation
    ) VALUES (
      v_renta_id, v_c_arr_inm,
      0.035000, 'PERCENT', 100, 'E.T. Art. 401',
      'Retención del 3.5% sobre arrendamiento de bienes raíces / inmuebles'
    );
  END IF;

  -- ReteICA Bogotá (11001)
  IF v_c_ica_comp IS NOT NULL THEN
    INSERT INTO tax_rules (
      tax_type_id, tax_concept_id, municipality_code,
      rate, rate_basis, priority, legal_reference, explanation
    ) VALUES (
      v_ica_id, v_c_ica_comp, '11001',
      0.011040, 'PER_MILLE', 100, 'Acuerdo 65 de 2002 / Resol. SDH Bogotá',
      'Tarifa de ReteICA del 11.04 por mil para compras y actividades comerciales en Bogotá'
    );
  END IF;

  IF v_c_ica_serv IS NOT NULL THEN
    INSERT INTO tax_rules (
      tax_type_id, tax_concept_id, municipality_code,
      rate, rate_basis, priority, legal_reference, explanation
    ) VALUES (
      v_ica_id, v_c_ica_serv, '11001',
      0.009660, 'PER_MILLE', 100, 'Acuerdo 65 de 2002 / Resol. SDH Bogotá',
      'Tarifa de ReteICA del 9.66 por mil para servicios generales en Bogotá'
    );
  END IF;

  IF v_c_ica_hon IS NOT NULL THEN
    INSERT INTO tax_rules (
      tax_type_id, tax_concept_id, municipality_code,
      rate, rate_basis, priority, legal_reference, explanation
    ) VALUES (
      v_ica_id, v_c_ica_hon, '11001',
      0.009660, 'PER_MILLE', 100, 'Acuerdo 65 de 2002 / Resol. SDH Bogotá',
      'Tarifa de ReteICA del 9.66 por mil para actividades profesionales y de consultoría en Bogotá'
    );
  END IF;

END $$;
