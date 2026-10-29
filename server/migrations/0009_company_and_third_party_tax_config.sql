-- 0009_company_and_third_party_tax_config.sql: Parametrización dinámica de impuestos por empresa y tercero

-- 1. Configuración global/por defecto de impuestos por empresa y tipo de operación/documento
CREATE TABLE IF NOT EXISTS company_tax_configurations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tax_type_id              uuid NOT NULL REFERENCES tax_types(id) ON DELETE CASCADE,
  operation_type           varchar(16) NOT NULL DEFAULT 'ALL' CHECK (operation_type IN ('ISSUED', 'RECEIVED', 'ALL')),
  document_category        varchar(32) NOT NULL DEFAULT 'ALL' CHECK (document_category IN ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'SUPPORT', 'ALL')),
  is_enabled               boolean NOT NULL DEFAULT true,
  default_rate             numeric(10,6),
  rate_basis               varchar(10) NOT NULL DEFAULT 'PERCENT' CHECK (rate_basis IN ('PERCENT', 'PER_MILLE')),
  default_concept_id       uuid REFERENCES tax_concepts(id) ON DELETE SET NULL,
  min_base_cop             numeric(20,2) NOT NULL DEFAULT 0,
  applies_to_declarant     boolean,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_company_tax_config UNIQUE (company_id, tax_type_id, operation_type, document_category)
);

CREATE INDEX IF NOT EXISTS company_tax_config_lookup_idx
  ON company_tax_configurations (company_id, operation_type, is_enabled);

-- 2. Parametrización específica de impuestos por tercero y tipo de operación
CREATE TABLE IF NOT EXISTS third_party_tax_rules (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  third_party_id           uuid NOT NULL REFERENCES third_parties(id) ON DELETE CASCADE,
  tax_type_id              uuid NOT NULL REFERENCES tax_types(id) ON DELETE CASCADE,
  operation_type           varchar(16) NOT NULL DEFAULT 'ALL' CHECK (operation_type IN ('ISSUED', 'RECEIVED', 'ALL')),
  document_category        varchar(32) NOT NULL DEFAULT 'ALL' CHECK (document_category IN ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'SUPPORT', 'ALL')),
  is_exempt                boolean NOT NULL DEFAULT false,
  custom_rate              numeric(10,6),
  rate_basis               varchar(10) NOT NULL DEFAULT 'PERCENT' CHECK (rate_basis IN ('PERCENT', 'PER_MILLE')),
  custom_concept_id        uuid REFERENCES tax_concepts(id) ON DELETE SET NULL,
  municipality_code        varchar(10),
  notes                    text,
  valid_from               date NOT NULL DEFAULT CURRENT_DATE,
  valid_to                 date NOT NULL DEFAULT '9999-12-31',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_third_party_tax_rule UNIQUE (company_id, third_party_id, tax_type_id, operation_type, document_category),
  CONSTRAINT third_party_tax_rule_dates_check CHECK (valid_from <= valid_to)
);

CREATE INDEX IF NOT EXISTS third_party_tax_rule_lookup_idx
  ON third_party_tax_rules (company_id, third_party_id, tax_type_id, operation_type);

