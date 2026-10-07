-- Accountant · Fase 1 · Esquema relacional inicial
-- PostgreSQL 16+. Tipos: UUID para identidad, NUMERIC para dinero,
-- TIMESTAMPTZ para instantes, DATE para fechas contables, JSONB solo
-- para payloads crudos, snapshots, metadata y auditoría.

/* ------------------------------------------------------------------ */
/* 1. Empresas                                                         */
/* ------------------------------------------------------------------ */

CREATE TABLE companies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nit          varchar(20)  NOT NULL,
  legal_name   varchar(255) NOT NULL,
  trade_name   varchar(255),
  currency     char(3)      NOT NULL DEFAULT 'COP',
  timezone     varchar(64)  NOT NULL DEFAULT 'America/Bogota',
  active       boolean      NOT NULL DEFAULT true,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT companies_nit_unique UNIQUE (nit),
  CONSTRAINT companies_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

/* ------------------------------------------------------------------ */
/* 2. Importaciones                                                    */
/* ------------------------------------------------------------------ */

CREATE TABLE imports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies (id),
  source          varchar(64)  NOT NULL DEFAULT 'RADIAN',
  filename        varchar(512) NOT NULL,
  file_sha256     char(64)     NOT NULL,
  started_at      timestamptz  NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  status          varchar(32)  NOT NULL DEFAULT 'PENDING',
  rows_total      integer      NOT NULL DEFAULT 0,
  rows_inserted   integer      NOT NULL DEFAULT 0,
  rows_updated    integer      NOT NULL DEFAULT 0,
  rows_unchanged  integer      NOT NULL DEFAULT 0,
  rows_rejected   integer      NOT NULL DEFAULT 0,
  warnings_count  integer      NOT NULL DEFAULT 0,
  error_message   text,
  created_by      varchar(64),
  created_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT imports_status_check
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED')),
  CONSTRAINT imports_sha_unique UNIQUE (company_id, file_sha256),
  CONSTRAINT imports_counters_check
    CHECK (rows_total >= 0 AND rows_inserted >= 0 AND rows_updated >= 0
           AND rows_unchanged >= 0 AND rows_rejected >= 0)
);

CREATE INDEX imports_company_created_idx ON imports (company_id, created_at DESC);

/* ------------------------------------------------------------------ */
/* 3. Terceros (un solo maestro: cliente/proveedor según la operación) */
/* ------------------------------------------------------------------ */

CREATE TABLE third_parties (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies (id),
  tax_id          varchar(20)  NOT NULL,
  check_digit     varchar(4),
  legal_name      varchar(512),
  normalized_name varchar(512),
  first_seen_at   timestamptz  NOT NULL DEFAULT now(),
  last_seen_at    timestamptz  NOT NULL DEFAULT now(),
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT third_parties_company_tax_unique UNIQUE (company_id, tax_id)
);

CREATE INDEX third_parties_company_name_idx ON third_parties (company_id, normalized_name);

CREATE TABLE third_party_history (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  third_party_id    uuid NOT NULL REFERENCES third_parties (id),
  valid_from        timestamptz NOT NULL DEFAULT now(),
  valid_to          timestamptz,
  tax_id            varchar(20),
  legal_name        varchar(512),
  normalized_name   varchar(512),
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_import_id  uuid REFERENCES imports (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT third_party_history_open_check
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE INDEX third_party_history_party_idx
  ON third_party_history (third_party_id, valid_from DESC);
CREATE UNIQUE INDEX third_party_history_single_open_idx
  ON third_party_history (third_party_id) WHERE valid_to IS NULL;

/* ------------------------------------------------------------------ */
/* 4. Catálogos: tipos de documento e impuestos                        */
/* ------------------------------------------------------------------ */

CREATE TABLE document_types (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 varchar(64) NOT NULL,
  name                 varchar(128) NOT NULL,
  category             varchar(32) NOT NULL,
  is_economic_document boolean NOT NULL DEFAULT true,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_types_code_unique UNIQUE (code),
  CONSTRAINT document_types_category_check
    CHECK (category IN ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'SUPPORT', 'PAYROLL', 'EVENT', 'OTHER'))
);

CREATE TABLE tax_types (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(32) NOT NULL,
  name       varchar(128) NOT NULL,
  category   varchar(32) NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_types_code_unique UNIQUE (code),
  CONSTRAINT tax_types_category_check
    CHECK (category IN ('VAT', 'INDIRECT', 'WITHHOLDING', 'OTHER'))
);

/* ------------------------------------------------------------------ */
/* 5. Documentos (tabla transaccional central)                         */
/* ------------------------------------------------------------------ */

CREATE TABLE documents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies (id),
  external_uid         varchar(128) NOT NULL,
  document_type_id     uuid NOT NULL REFERENCES document_types (id),
  folio                varchar(64),
  prefix               varchar(16),
  currency             char(3) NOT NULL DEFAULT 'COP',
  payment_form         varchar(16),
  payment_method       varchar(16),
  issued_at            date,
  received_at          timestamptz,
  issuer_id            uuid REFERENCES third_parties (id),
  receiver_id          uuid REFERENCES third_parties (id),
  total                numeric(20,2) NOT NULL DEFAULT 0,
  direction            varchar(16) NOT NULL DEFAULT 'UNKNOWN',
  status               varchar(64) NOT NULL DEFAULT 'UNKNOWN',
  source               varchar(32) NOT NULL DEFAULT 'RADIAN',
  source_hash          char(64) NOT NULL,
  first_seen_import_id uuid REFERENCES imports (id),
  last_seen_import_id  uuid REFERENCES imports (id),
  is_active            boolean NOT NULL DEFAULT true,
  superseded_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documents_company_uid_unique UNIQUE (company_id, external_uid),
  CONSTRAINT documents_direction_check CHECK (direction IN ('ISSUED', 'RECEIVED', 'UNKNOWN')),
  CONSTRAINT documents_source_check CHECK (source IN ('RADIAN', 'MANUAL', 'API')),
  CONSTRAINT documents_total_check CHECK (total >= 0)
);

CREATE INDEX documents_company_issued_idx        ON documents (company_id, issued_at DESC);
CREATE INDEX documents_company_received_idx      ON documents (company_id, received_at DESC);
CREATE INDEX documents_company_type_issued_idx   ON documents (company_id, document_type_id, issued_at DESC);
CREATE INDEX documents_company_issuer_issued_idx ON documents (company_id, issuer_id, issued_at DESC);
CREATE INDEX documents_company_receiver_issued_idx ON documents (company_id, receiver_id, issued_at DESC);
CREATE INDEX documents_company_status_idx        ON documents (company_id, status);
CREATE INDEX documents_company_direction_issued_idx ON documents (company_id, direction, issued_at DESC);

CREATE TABLE document_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    uuid NOT NULL REFERENCES documents (id),
  version_number integer NOT NULL,
  source_hash    char(64) NOT NULL,
  snapshot       jsonb NOT NULL,
  import_id      uuid REFERENCES imports (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_versions_number_unique UNIQUE (document_id, version_number),
  CONSTRAINT document_versions_number_check CHECK (version_number >= 1)
);

CREATE INDEX document_versions_document_idx ON document_versions (document_id, created_at DESC);

CREATE TABLE document_status_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents (id),
  status      varchar(64) NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  import_id   uuid REFERENCES imports (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX document_status_history_document_idx
  ON document_status_history (document_id, observed_at DESC);

CREATE TABLE document_taxes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES documents (id),
  tax_type_id  uuid NOT NULL REFERENCES tax_types (id),
  taxable_base numeric(20,2),
  rate         numeric(10,6),
  amount       numeric(20,2) NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_taxes_document_tax_unique UNIQUE (document_id, tax_type_id),
  CONSTRAINT document_taxes_amount_check CHECK (amount >= 0),
  -- RADIAN no trae base ni tarifa por impuesto: se guardan NULL, nunca se infieren.
  CONSTRAINT document_taxes_base_when_rate CHECK (rate IS NULL OR taxable_base IS NOT NULL)
);

CREATE INDEX document_taxes_tax_document_idx ON document_taxes (tax_type_id, document_id);
CREATE INDEX document_taxes_document_idx     ON document_taxes (document_id);

/* ------------------------------------------------------------------ */
/* 6. Eventos (Application response y afines)                          */
/* ------------------------------------------------------------------ */

CREATE TABLE document_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies (id),
  document_id    uuid REFERENCES documents (id),
  event_uid      varchar(128) NOT NULL,
  event_type     varchar(64) NOT NULL,
  status         varchar(64),
  occurred_at    timestamptz,
  issuer_id      uuid REFERENCES third_parties (id),
  receiver_id    uuid REFERENCES third_parties (id),
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  import_id      uuid REFERENCES imports (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_events_uid_unique UNIQUE (company_id, event_uid)
);

CREATE INDEX document_events_document_idx ON document_events (document_id);
CREATE INDEX document_events_company_type_idx ON document_events (company_id, event_type, occurred_at DESC);

/* ------------------------------------------------------------------ */
/* 7. Filas crudas de la importación                                   */
/* ------------------------------------------------------------------ */

CREATE TABLE import_rows (
  id               bigserial PRIMARY KEY,
  import_id        uuid NOT NULL REFERENCES imports (id),
  row_number       integer NOT NULL,
  external_uid     varchar(128),
  raw_payload      jsonb NOT NULL,
  processing_status varchar(32) NOT NULL DEFAULT 'PENDING',
  error_code       varchar(64),
  error_message    text,
  document_id      uuid REFERENCES documents (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_rows_import_row_unique UNIQUE (import_id, row_number),
  CONSTRAINT import_rows_status_check
    CHECK (processing_status IN ('PENDING', 'PROCESSED', 'UNCHANGED', 'UPDATED', 'REJECTED', 'ERROR'))
);

CREATE INDEX import_rows_document_idx ON import_rows (document_id);
CREATE INDEX import_rows_import_status_idx ON import_rows (import_id, processing_status);

/* ------------------------------------------------------------------ */
/* 8. Validaciones                                                     */
/* ------------------------------------------------------------------ */

CREATE TABLE validation_issues (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies (id),
  document_id   uuid REFERENCES documents (id),
  import_row_id bigint REFERENCES import_rows (id),
  import_id     uuid REFERENCES imports (id),
  rule_code     varchar(64) NOT NULL,
  severity      varchar(16) NOT NULL,
  message       text NOT NULL,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at   timestamptz,
  resolved_by   varchar(64),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT validation_issues_severity_check
    CHECK (severity IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),
  CONSTRAINT validation_issues_rule_check CHECK (char_length(rule_code) > 0)
);

CREATE INDEX validation_issues_company_severity_idx
  ON validation_issues (company_id, severity, resolved_at);
CREATE INDEX validation_issues_document_idx ON validation_issues (document_id);
CREATE INDEX validation_issues_import_row_idx ON validation_issues (import_row_id);
CREATE INDEX validation_issues_company_created_idx ON validation_issues (company_id, created_at DESC);

-- Idempotencia de validaciones: no duplicar la misma incidencia abierta.
CREATE UNIQUE INDEX validation_issues_open_document_unique
  ON validation_issues (company_id, rule_code, document_id)
  WHERE document_id IS NOT NULL AND resolved_at IS NULL;
CREATE UNIQUE INDEX validation_issues_open_row_unique
  ON validation_issues (company_id, rule_code, import_row_id)
  WHERE import_row_id IS NOT NULL AND resolved_at IS NULL;

/* ------------------------------------------------------------------ */
/* 9. Configuración (global vs override por empresa)                   */
/* ------------------------------------------------------------------ */

CREATE TABLE settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES companies (id),
  scope       varchar(64) NOT NULL,
  key         varchar(128) NOT NULL,
  value       jsonb NOT NULL,
  value_type  varchar(16),
  description text,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settings_value_type_check
    CHECK (value_type IS NULL OR value_type IN ('string', 'number', 'boolean', 'array', 'object'))
  -- company_id NULL = global. UNIQUE normal de Postgres no cubre NULLs
  -- y UNIQUE (scope, key) impediría overrides por empresa: se usan índices parciales.
);

CREATE UNIQUE INDEX settings_global_partial_unique
  ON settings (scope, key) WHERE company_id IS NULL;
CREATE UNIQUE INDEX settings_company_key_unique
  ON settings (company_id, scope, key) WHERE company_id IS NOT NULL;

/* ------------------------------------------------------------------ */
/* 10. Auditoría                                                       */
/* ------------------------------------------------------------------ */

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  company_id  uuid REFERENCES companies (id),
  entity_type varchar(64) NOT NULL,
  entity_id   varchar(64) NOT NULL,
  action      varchar(32) NOT NULL,
  actor_type  varchar(32) NOT NULL DEFAULT 'SYSTEM',
  actor_id    varchar(64),
  before      jsonb,
  after       jsonb,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_action_check
    CHECK (action IN ('INSERT', 'UPDATE', 'DELETE', 'RESOLVE', 'IMPORT', 'LOGIN', 'SETTINGS'))
);

CREATE INDEX audit_log_company_created_idx ON audit_log (company_id, created_at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC);

/* ------------------------------------------------------------------ */
/* 11. Reportería agregada (derivada y reconstruible)                  */
/* ------------------------------------------------------------------ */

CREATE TABLE reporting_monthly (
  company_id               uuid NOT NULL REFERENCES companies (id),
  year                     smallint NOT NULL,
  month                    smallint NOT NULL,
  sales_count              bigint NOT NULL DEFAULT 0,
  sales_total              numeric(20,2) NOT NULL DEFAULT 0,
  purchase_count           bigint NOT NULL DEFAULT 0,
  purchase_total           numeric(20,2) NOT NULL DEFAULT 0,
  credit_notes_count       bigint NOT NULL DEFAULT 0,
  credit_notes_total       numeric(20,2) NOT NULL DEFAULT 0,
  payroll_count            bigint NOT NULL DEFAULT 0,
  payroll_total            numeric(20,2) NOT NULL DEFAULT 0,
  support_documents_count  bigint NOT NULL DEFAULT 0,
  support_documents_total  numeric(20,2) NOT NULL DEFAULT 0,
  vat_generated            numeric(20,2) NOT NULL DEFAULT 0,
  vat_deductible           numeric(20,2) NOT NULL DEFAULT 0,
  withholding_total        numeric(20,2) NOT NULL DEFAULT 0,
  unique_customers         bigint NOT NULL DEFAULT 0,
  unique_suppliers         bigint NOT NULL DEFAULT 0,
  documents_count          bigint NOT NULL DEFAULT 0,
  documents_with_issues    bigint NOT NULL DEFAULT 0,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reporting_monthly_pkey PRIMARY KEY (company_id, year, month),
  CONSTRAINT reporting_monthly_month_check CHECK (month BETWEEN 1 AND 12),
  CONSTRAINT reporting_monthly_year_check CHECK (year BETWEEN 1990 AND 2200)
);

CREATE TABLE reporting_counterparty_monthly (
  company_id          uuid NOT NULL REFERENCES companies (id),
  third_party_id      uuid NOT NULL REFERENCES third_parties (id),
  year                smallint NOT NULL,
  month               smallint NOT NULL,
  sales_count         bigint NOT NULL DEFAULT 0,
  sales_total         numeric(20,2) NOT NULL DEFAULT 0,
  purchase_count      bigint NOT NULL DEFAULT 0,
  purchase_total      numeric(20,2) NOT NULL DEFAULT 0,
  credit_notes_count  bigint NOT NULL DEFAULT 0,
  credit_notes_total  numeric(20,2) NOT NULL DEFAULT 0,
  tax_total           numeric(20,2) NOT NULL DEFAULT 0,
  first_transaction_date date,
  last_transaction_date   date,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reporting_counterparty_monthly_pkey
    PRIMARY KEY (company_id, third_party_id, year, month),
  CONSTRAINT reporting_counterparty_month_check CHECK (month BETWEEN 1 AND 12)
);

CREATE INDEX reporting_counterparty_lookup_idx
  ON reporting_counterparty_monthly (company_id, year, month);

CREATE TABLE reporting_tax_monthly (
  company_id    uuid NOT NULL REFERENCES companies (id),
  tax_type_id   uuid NOT NULL REFERENCES tax_types (id),
  year          smallint NOT NULL,
  month         smallint NOT NULL,
  direction     varchar(16) NOT NULL,
  document_count bigint NOT NULL DEFAULT 0,
  taxable_base  numeric(20,2),
  tax_amount    numeric(20,2) NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reporting_tax_monthly_pkey
    PRIMARY KEY (company_id, tax_type_id, year, month, direction),
  CONSTRAINT reporting_tax_monthly_month_check CHECK (month BETWEEN 1 AND 12),
  CONSTRAINT reporting_tax_monthly_direction_check CHECK (direction IN ('ISSUED', 'RECEIVED', 'UNKNOWN'))
);

/* ------------------------------------------------------------------ */
/* 12. updated_at automático                                           */
/* ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER companies_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER third_parties_updated_at BEFORE UPDATE ON third_parties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER documents_updated_at BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER settings_updated_at BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
