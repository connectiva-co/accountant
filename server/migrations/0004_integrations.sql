-- Accountant · Fase 7 · Integraciones multiempresa, secrets, matching RADIAN↔ERP y sincronización.
--
-- Diseño:
--   companies
--    ├─ settings (ya existente: company_id NULL = global)
--    └─ company_integrations          una fila por (empresa, provider)
--         ├─ integration_settings     JSONB no sensible, validado con Zod al leer/escribir
--         ├─ integration_secrets      payload cifrado AES-256-GCM (master key fuera de PG)
--         ├─ integration_sync_state   cursor incremental por recurso
--         └─ integration_runs         ejecuciones/observabilidad
--   integration_providers              catálogo de proveedores (SIIGO, WORLD_OFFICE, …)
--   document_integration_matches      estado RADIAN ↔ ERP por documento
--   sync_policies / sync_routes / sync_mappings / entity_external_refs / sync_conflicts
--
-- Nada de esto hardcodea Siigo: los providers entran solo por la fila de
-- integration_providers y el adapter registrado en la aplicación.

/* ------------------------------------------------------------------ */
/* 1. Catálogo de proveedores                                          */
/* ------------------------------------------------------------------ */

CREATE TABLE integration_providers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(64)  NOT NULL,
  name       varchar(128) NOT NULL,
  enabled    boolean      NOT NULL DEFAULT true,
  created_at timestamptz  NOT NULL DEFAULT now(),
  updated_at timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT integration_providers_code_unique UNIQUE (code)
);

/* ------------------------------------------------------------------ */
/* 2. Integraciones por empresa                                        */
/* ------------------------------------------------------------------ */

CREATE TABLE company_integrations (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                     uuid NOT NULL REFERENCES companies (id),
  provider_id                    uuid NOT NULL REFERENCES integration_providers (id),
  name                           varchar(128),
  enabled                        boolean     NOT NULL DEFAULT true,
  status                         varchar(32) NOT NULL DEFAULT 'NOT_CONFIGURED',
  last_connection_test_at        timestamptz,
  last_test_status               varchar(16),
  last_test_message              text,
  last_successful_connection_at  timestamptz,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  -- Una integración activa por (empresa, provider). Todas las capas superiores
  -- resuelven por company_integration_id, así que admitir varias por provider
  -- en el futuro solo requiere relajar este índice.
  CONSTRAINT company_integrations_provider_unique UNIQUE (company_id, provider_id),
  CONSTRAINT company_integrations_status_check
    CHECK (status IN ('NOT_CONFIGURED', 'CONFIGURED', 'CONNECTED', 'ERROR', 'DISABLED')),
  CONSTRAINT company_integrations_test_status_check
    CHECK (last_test_status IS NULL OR last_test_status IN ('OK', 'ERROR', 'TIMEOUT', 'AUTH_ERROR'))
);

CREATE INDEX company_integrations_company_idx ON company_integrations (company_id);
CREATE INDEX company_integrations_provider_idx ON company_integrations (provider_id);

/* ------------------------------------------------------------------ */
/* 3. Configuración no sensible por integración                       */
/* ------------------------------------------------------------------ */

CREATE TABLE integration_settings (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_integration_id   uuid NOT NULL REFERENCES company_integrations (id) ON DELETE CASCADE,
  settings                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_settings_integration_unique UNIQUE (company_integration_id),
  CONSTRAINT integration_settings_object_check CHECK (jsonb_typeof(settings) = 'object')
);

/* ------------------------------------------------------------------ */
/* 4. Secretos por integración (cifrados en la aplicación)             */
/* ------------------------------------------------------------------ */

CREATE TABLE integration_secrets (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_integration_id    uuid NOT NULL REFERENCES company_integrations (id) ON DELETE CASCADE,
  encrypted_payload         text        NOT NULL,   -- base64 (AES-256-GCM)
  nonce                     bytea       NOT NULL,   -- IV de 12 bytes
  auth_tag                  bytea       NOT NULL,   -- tag de 16 bytes
  encryption_key_version    integer     NOT NULL,    -- rotación de master key
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_secrets_integration_unique UNIQUE (company_integration_id),
  CONSTRAINT integration_secrets_nonce_check  CHECK (octet_length(nonce) = 12),
  CONSTRAINT integration_secrets_tag_check    CHECK (octet_length(auth_tag) = 16),
  CONSTRAINT integration_secrets_version_check CHECK (encryption_key_version >= 1)
);

/* ------------------------------------------------------------------ */
/* 5. Estado de sincronización incremental por recurso                 */
/* ------------------------------------------------------------------ */

CREATE TABLE integration_sync_state (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_integration_id   uuid NOT NULL REFERENCES company_integrations (id) ON DELETE CASCADE,
  resource                 varchar(64) NOT NULL,
  last_synced_at           timestamptz,
  cursor                   jsonb,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_sync_state_unique UNIQUE (company_integration_id, resource)
);

/* ------------------------------------------------------------------ */
/* 6. Ejecuciones (integración / sincronización)                       */
/* ------------------------------------------------------------------ */

CREATE TABLE integration_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES companies (id),
  company_integration_id   uuid REFERENCES company_integrations (id) ON DELETE SET NULL,
  operation                varchar(64) NOT NULL,
  started_at               timestamptz NOT NULL DEFAULT now(),
  finished_at              timestamptz,
  status                   varchar(16) NOT NULL DEFAULT 'RUNNING',
  records_read             integer NOT NULL DEFAULT 0,
  records_matched          integer NOT NULL DEFAULT 0,
  records_not_found        integer NOT NULL DEFAULT 0,
  records_failed           integer NOT NULL DEFAULT 0,
  error_summary            text,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT integration_runs_status_check
    CHECK (status IN ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  CONSTRAINT integration_runs_counters_check
    CHECK (records_read >= 0 AND records_matched >= 0 AND records_not_found >= 0 AND records_failed >= 0)
);

CREATE INDEX integration_runs_company_started_idx ON integration_runs (company_id, started_at DESC);
CREATE INDEX integration_runs_integration_idx ON integration_runs (company_integration_id, started_at DESC);

/* ------------------------------------------------------------------ */
/* 7. Matching RADIAN ↔ ERP                                            */
/* ------------------------------------------------------------------ */

CREATE TABLE document_integration_matches (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES companies (id),
  document_id              uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  company_integration_id   uuid NOT NULL REFERENCES company_integrations (id) ON DELETE CASCADE,
  external_id              varchar(128),
  external_document_type   varchar(64),
  external_number          varchar(64),
  match_status             varchar(16)  NOT NULL DEFAULT 'NOT_CHECKED',
  match_method             varchar(32),
  confidence               numeric(6,4),
  matched_at               timestamptz,
  last_checked_at          timestamptz,
  external_payload         jsonb,
  error_message            text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_matches_unique UNIQUE (company_integration_id, document_id),
  CONSTRAINT document_matches_status_check
    CHECK (match_status IN ('NOT_CHECKED', 'MATCHED', 'NOT_FOUND', 'AMBIGUOUS', 'ERROR')),
  -- ERROR != NOT_FOUND: un fallo del ERP nunca puede registrarse como ausencia.
  CONSTRAINT document_matches_method_check
    CHECK (match_method IS NULL OR match_method IN ('CUFE', 'TAX_ID', 'FOLIO_THIRD_PARTY', 'NUMBER_THIRD_PARTY_TOTAL_DATE', 'EXTERNAL_ID')),
  CONSTRAINT document_matches_confidence_check
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  -- Un match solo puede tener "éxito" si hay identificador externo.
  CONSTRAINT document_matches_matched_check
    CHECK (match_status <> 'MATCHED' OR (external_id IS NOT NULL AND matched_at IS NOT NULL))
);

CREATE INDEX document_matches_document_idx ON document_integration_matches (document_id);
CREATE INDEX document_matches_company_status_idx ON document_integration_matches (company_id, match_status);

/**
 * Impide que un documento y una integración de empresas distintas se relacionen
 * (no se puede garantizar con CHECK: las FK están en tablas diferentes).
 * Aplica en INSERT y UPDATE.
 */
CREATE OR REPLACE FUNCTION enforce_match_company_consistency() RETURNS trigger AS $$
DECLARE
  v_doc_company uuid;
  v_int_company uuid;
BEGIN
  SELECT company_id INTO v_doc_company FROM documents WHERE id = NEW.document_id;
  SELECT company_id INTO v_int_company FROM company_integrations WHERE id = NEW.company_integration_id;

  IF v_doc_company IS NULL THEN
    RAISE EXCEPTION 'document_integration_matches: documento inexistente %', NEW.document_id;
  END IF;
  IF v_int_company IS NULL THEN
    RAISE EXCEPTION 'document_integration_matches: integración inexistente %', NEW.company_integration_id;
  END IF;
  IF v_doc_company <> NEW.company_id OR v_int_company <> NEW.company_id THEN
    RAISE EXCEPTION 'document_integration_matches: empresa inconsistente (documento %, integración %, empresa %)',
      v_doc_company, v_int_company, NEW.company_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_matches_company_ck
  BEFORE INSERT OR UPDATE ON document_integration_matches
  FOR EACH ROW EXECUTE FUNCTION enforce_match_company_consistency();

/* ------------------------------------------------------------------ */
/* 8. Políticas de sincronización por dominio                          */
/* ------------------------------------------------------------------ */

CREATE TABLE sync_policies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies (id),
  resource_type       varchar(64) NOT NULL,
  enabled             boolean     NOT NULL DEFAULT true,
  master_source       varchar(64) NOT NULL DEFAULT 'ACCOUNTANT',
  sync_mode           varchar(16) NOT NULL DEFAULT 'MANUAL',
  conflict_strategy   varchar(24) NOT NULL DEFAULT 'DO_NOT_OVERWRITE',
  schedule_type       varchar(16),
  schedule_expression varchar(128),
  last_run_at         timestamptz,
  next_run_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_policies_unique UNIQUE (company_id, resource_type),
  CONSTRAINT sync_policies_mode_check
    CHECK (sync_mode IN ('MANUAL', 'SCHEDULED', 'AUTOMATIC')),
  CONSTRAINT sync_policies_conflict_check
    CHECK (conflict_strategy IN ('SOURCE_WINS', 'TARGET_WINS', 'NEWEST_WINS', 'MANUAL_REVIEW', 'DO_NOT_OVERWRITE')),
  CONSTRAINT sync_policies_schedule_check
    CHECK (
      (sync_mode = 'SCHEDULED' AND schedule_type IS NOT NULL) OR
      (sync_mode <> 'SCHEDULED' AND schedule_type IS NULL)
    ),
  -- ACCOUNTANT (fuente maestra = la app) o el código de un provider registrado.
  CONSTRAINT sync_policies_master_check CHECK (master_source ~ '^[A-Z][A-Z0-9_]*$')
);

/* ------------------------------------------------------------------ */
/* 9. Rutas de sincronización (lectura / escritura por recurso)        */
/* ------------------------------------------------------------------ */

CREATE TABLE sync_routes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_policy_id         uuid NOT NULL REFERENCES sync_policies (id) ON DELETE CASCADE,
  source_integration_id  uuid REFERENCES company_integrations (id) ON DELETE CASCADE,
  target_integration_id  uuid REFERENCES company_integrations (id) ON DELETE CASCADE,
  read_enabled           boolean NOT NULL DEFAULT false,
  write_enabled          boolean NOT NULL DEFAULT false,
  priority               integer NOT NULL DEFAULT 100,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- source NULL = Accountant como origen; target NULL = Accountant como destino.
  CONSTRAINT sync_routes_endpoints_check
    CHECK (source_integration_id IS NOT NULL OR target_integration_id IS NOT NULL),
  CONSTRAINT sync_routes_read_check
    CHECK (NOT read_enabled OR source_integration_id IS NOT NULL),
  CONSTRAINT sync_routes_write_check
    CHECK (NOT write_enabled OR target_integration_id IS NOT NULL),
  CONSTRAINT sync_routes_no_self_check
    CHECK (source_integration_id IS NULL OR target_integration_id IS NULL
           OR source_integration_id <> target_integration_id),
  CONSTRAINT sync_routes_priority_check CHECK (priority >= 0)
);

CREATE INDEX sync_routes_policy_idx ON sync_routes (sync_policy_id, priority);

/* ------------------------------------------------------------------ */
/* 10. Mappings por provider (recurso Accountant ↔ recurso externo)    */
/* ------------------------------------------------------------------ */

CREATE TABLE sync_mappings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies (id),
  resource_type    varchar(64) NOT NULL,
  mapping_type     varchar(32) NOT NULL,
  source_provider  varchar(64) NOT NULL DEFAULT 'ACCOUNTANT',
  target_provider  varchar(64) NOT NULL DEFAULT 'ACCOUNTANT',
  source_value     varchar(256) NOT NULL,
  target_value     varchar(256) NOT NULL,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled          boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_mappings_unique
    UNIQUE (company_id, resource_type, mapping_type, source_provider, target_provider, source_value),
  CONSTRAINT sync_mappings_provider_check
    CHECK (source_provider ~ '^[A-Z][A-Z0-9_]*$' AND target_provider ~ '^[A-Z][A-Z0-9_]*$')
);

CREATE INDEX sync_mappings_lookup_idx
  ON sync_mappings (company_id, resource_type, mapping_type, source_provider, target_provider);

/* ------------------------------------------------------------------ */
/* 11. Identidad externa de una entidad local                         */
/* ------------------------------------------------------------------ */

CREATE TABLE entity_external_refs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES companies (id),
  entity_type              varchar(64) NOT NULL,
  entity_id                uuid NOT NULL,
  company_integration_id   uuid NOT NULL REFERENCES company_integrations (id) ON DELETE CASCADE,
  external_id              varchar(128) NOT NULL,
  external_code            varchar(128),
  last_seen_at             timestamptz NOT NULL DEFAULT now(),
  source_hash              varchar(64),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entity_external_refs_unique
    UNIQUE (company_integration_id, entity_type, external_id)
);

CREATE INDEX entity_external_refs_entity_idx ON entity_external_refs (company_id, entity_type, entity_id);

/* ------------------------------------------------------------------ */
/* 12. Conflictos de sincronización                                    */
/* ------------------------------------------------------------------ */

CREATE TABLE sync_conflicts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES companies (id),
  resource_type            varchar(64) NOT NULL,
  entity_type              varchar(64) NOT NULL DEFAULT 'THIRD_PARTY',
  entity_id                uuid NOT NULL,
  source_integration_id    uuid REFERENCES company_integrations (id) ON DELETE SET NULL,
  target_integration_id    uuid REFERENCES company_integrations (id) ON DELETE SET NULL,
  source_payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  conflict_type            varchar(32) NOT NULL DEFAULT 'FIELD_MISMATCH',
  status                   varchar(16) NOT NULL DEFAULT 'OPEN',
  resolution               varchar(24),
  resolved_at              timestamptz,
  resolved_by              varchar(64),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_conflicts_status_check CHECK (status IN ('OPEN', 'RESOLVED', 'IGNORED')),
  CONSTRAINT sync_conflicts_resolution_check
    CHECK (resolution IS NULL OR resolution IN ('SOURCE_WINS', 'TARGET_WINS', 'NEWEST_WINS', 'MANUAL_REVIEW', 'DO_NOT_OVERWRITE')),
  CONSTRAINT sync_conflicts_resolved_check
    CHECK (status <> 'RESOLVED' OR resolved_at IS NOT NULL)
);

CREATE INDEX sync_conflicts_company_status_idx ON sync_conflicts (company_id, status, created_at DESC);

/* ------------------------------------------------------------------ */
/* 13. Auditoría: acciones de integración y sync                       */
/* ------------------------------------------------------------------ */

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check
  CHECK (action IN (
    'INSERT', 'UPDATE', 'DELETE', 'RESOLVE', 'IMPORT', 'LOGIN', 'SETTINGS',
    'INTEGRATION_CREATED', 'INTEGRATION_ENABLED', 'INTEGRATION_DISABLED',
    'INTEGRATION_SETTINGS_UPDATED', 'INTEGRATION_CREDENTIALS_UPDATED',
    'INTEGRATION_CONNECTION_TESTED', 'SYNC_RUN'
  ));

/* ------------------------------------------------------------------ */
/* 14. updated_at en las tablas nuevas                                 */
/* ------------------------------------------------------------------ */

CREATE TRIGGER integration_providers_updated_at BEFORE UPDATE ON integration_providers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER company_integrations_updated_at BEFORE UPDATE ON company_integrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER integration_settings_updated_at BEFORE UPDATE ON integration_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER integration_secrets_updated_at BEFORE UPDATE ON integration_secrets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER integration_sync_state_updated_at BEFORE UPDATE ON integration_sync_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER document_matches_updated_at BEFORE UPDATE ON document_integration_matches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER sync_policies_updated_at BEFORE UPDATE ON sync_policies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER sync_routes_updated_at BEFORE UPDATE ON sync_routes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER sync_mappings_updated_at BEFORE UPDATE ON sync_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER entity_external_refs_updated_at BEFORE UPDATE ON entity_external_refs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER sync_conflicts_updated_at BEFORE UPDATE ON sync_conflicts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/* ------------------------------------------------------------------ */
/* 15. Seeds: proveedores iniciales                                    */
/* ------------------------------------------------------------------ */

INSERT INTO integration_providers (code, name) VALUES
  ('SIIGO', 'Siigo'),
  ('WORLD_OFFICE', 'World Office')
ON CONFLICT (code) DO NOTHING;
