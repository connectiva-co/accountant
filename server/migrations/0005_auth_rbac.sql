-- 0005_auth_rbac.sql
--
-- Usuarios, autenticación, RBAC y asignación explícita de empresas.
--
-- Regla central: NINGÚN usuario accede a una empresa solo por conocer su id.
-- El acceso existe solo si hay company_membership con status ACTIVE + el
-- permiso requerido para la operación (resuelto por membership, no global).
--
--   users ─┬─ company_memberships ─┬─ membership_roles ─ roles ─ role_permissions ─ permissions
--          ├─ user_sessions           (membership_id, role_id)
--          ├─ user_mfa_methods
--          ├─ user_recovery_codes
--          └─ login_attempts
--
-- roles.company_id IS NULL  → rol preset del sistema (OWNER, ACCOUNTANT, …)
-- roles.company_id = X      → rol personalizado de esa empresa
-- users.platform_admin      → plano administrativo de plataforma, separado del
--                             RBAC de empresa (no es un rol de company_memberships)
--
-- Nada de esto borra físicamente usuarios ni memberships (soft delete: status).

/* ------------------------------------------------------------------ */
/* 1. Usuarios                                                         */
/* ------------------------------------------------------------------ */

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 varchar(320) NOT NULL,
  full_name             varchar(160) NOT NULL DEFAULT '',
  password_hash         text        NOT NULL,
  status                varchar(16) NOT NULL DEFAULT 'ACTIVE'
                          CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED', 'LOCKED')),
  must_change_password  boolean     NOT NULL DEFAULT false,
  platform_admin        boolean     NOT NULL DEFAULT false,
  failed_attempts       integer     NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  last_login_ip         inet,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_format_check CHECK (position('@' in email) > 1)
);

CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
CREATE INDEX users_status_idx ON users (status);

/* ------------------------------------------------------------------ */
/* 2. Membresías por empresa (asignación explícita)                    */
/* ------------------------------------------------------------------ */

CREATE TABLE company_memberships (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies (id),
  user_id          uuid NOT NULL REFERENCES users (id),
  status           varchar(16) NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('INVITED', 'ACTIVE', 'DISABLED')),
  disabled_at      timestamptz,
  disabled_by      uuid REFERENCES users (id),
  disabled_reason  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_memberships_unique UNIQUE (company_id, user_id),
  CONSTRAINT company_memberships_disabled_check
    CHECK (status <> 'DISABLED' OR disabled_at IS NOT NULL)
);

CREATE INDEX company_memberships_user_idx ON company_memberships (user_id, status);
CREATE INDEX company_memberships_company_idx ON company_memberships (company_id, status);

/* ------------------------------------------------------------------ */
/* 3. Roles (globales del sistema o personalizados por empresa)        */
/* ------------------------------------------------------------------ */

CREATE TABLE roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid REFERENCES companies (id),
  code         varchar(64)  NOT NULL,
  name         varchar(120) NOT NULL,
  description  text,
  is_system    boolean NOT NULL DEFAULT false,
  is_editable  boolean NOT NULL DEFAULT true,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- UNIQUE(company_id, code) no protege los NULL: dos índices parciales sí.
CREATE UNIQUE INDEX roles_global_code_key ON roles (code) WHERE company_id IS NULL;
CREATE UNIQUE INDEX roles_company_code_key ON roles (company_id, code) WHERE company_id IS NOT NULL;

/* ------------------------------------------------------------------ */
/* 4. Roles por membership (un usuario, varios roles en la misma       */
/*    empresa: ACCOUNTANT + INTEGRATION_MANAGER)                       */
/* ------------------------------------------------------------------ */

CREATE TABLE membership_roles (
  membership_id uuid NOT NULL REFERENCES company_memberships (id) ON DELETE CASCADE,
  role_id       uuid NOT NULL REFERENCES roles (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, role_id)
);

CREATE INDEX membership_roles_role_idx ON membership_roles (role_id);

/* ------------------------------------------------------------------ */
/* 5. Permisos                                                         */
/* ------------------------------------------------------------------ */

CREATE TABLE permissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              varchar(96) NOT NULL UNIQUE,
  name              varchar(120) NOT NULL,
  description       text,
  category          varchar(48) NOT NULL,
  risk_level        varchar(16) NOT NULL DEFAULT 'LOW'
                      CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  -- Operaciones sensibles exigen autenticación reciente (step-up).
  requires_step_up  boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX permissions_category_idx ON permissions (category);

/* ------------------------------------------------------------------ */
/* 6. Permisos por rol                                                 */
/* ------------------------------------------------------------------ */

CREATE TABLE role_permissions (
  role_id       uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX role_permissions_permission_idx ON role_permissions (permission_id);

/* ------------------------------------------------------------------ */
/* 7. MFA (TOTP)                                                       */
/* ------------------------------------------------------------------ */

CREATE TABLE user_mfa_methods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type            varchar(16) NOT NULL DEFAULT 'TOTP' CHECK (type IN ('TOTP')),
  status          varchar(16) NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'ACTIVE', 'DISABLED')),
  -- Cifrado con AES-256-GCM (SECRETS_MASTER_KEY): nunca en texto plano.
  encrypted_secret text NOT NULL,
  verified_at     timestamptz,
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, type)
);

/* ------------------------------------------------------------------ */
/* 8. Recovery codes (hasheados, de un solo uso)                       */
/* ------------------------------------------------------------------ */

CREATE TABLE user_recovery_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX user_recovery_codes_user_idx ON user_recovery_codes (user_id, used_at);

/* ------------------------------------------------------------------ */
/* 9. Sesiones (cookie httpOnly + refresh con rotación)                */
/* ------------------------------------------------------------------ */

CREATE TABLE user_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Solo se guardan hashes (SHA-256) de los tokens: si la BD se filtra,
  -- las cookies robadas no sirven.
  session_token_hash  text NOT NULL UNIQUE,
  refresh_token_hash  text NOT NULL UNIQUE,
  csrf_token_hash     text NOT NULL,
  ip                  inet,
  user_agent          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_used_at        timestamptz NOT NULL DEFAULT now(),
  -- Última autenticación explícita (login o step-up): base del step-up auth.
  last_auth_at        timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  refresh_expires_at  timestamptz NOT NULL,
  revoked_at          timestamptz,
  revoked_reason      varchar(64)
);

CREATE INDEX user_sessions_user_idx ON user_sessions (user_id, expires_at DESC);

/* ------------------------------------------------------------------ */
/* 10. Intentos de login (rate limiting / lockout / fuerza bruta)      */
/* ------------------------------------------------------------------ */

CREATE TABLE login_attempts (
  id             bigserial PRIMARY KEY,
  email          varchar(320) NOT NULL,
  user_id        uuid REFERENCES users (id),
  ip             inet,
  user_agent     text,
  success        boolean NOT NULL,
  failure_reason varchar(48),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX login_attempts_email_idx ON login_attempts (lower(email), created_at DESC);
CREATE INDEX login_attempts_ip_idx ON login_attempts (ip, created_at DESC);

/* ------------------------------------------------------------------ */
/* 11. Auditoría atribuible                                             */
/* ------------------------------------------------------------------ */

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_user_id uuid REFERENCES users (id);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS target_user_id uuid REFERENCES users (id);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip inet;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_agent text;

CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_user_id, created_at DESC);

-- Nunca se auditan secretos: la responsabilidad es del código (redactSecrets),
-- aquí solo se amplía el catálogo de acciones del módulo de usuarios/seguridad.
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
    'PASSWORD_RESET_REQUESTED', 'PASSWORD_CHANGED', 'MFA_REQUIRED',
    'MFA_RESET', 'MFA_VERIFIED', 'SESSION_REVOKED', 'COMPANY_IDENTITY_UPDATED'
  ));

/* ------------------------------------------------------------------ */
/* 12. Seed: permisos                                                  */
/* ------------------------------------------------------------------ */

INSERT INTO permissions (code, name, description, category, risk_level, requires_step_up) VALUES
  ('radian.import',              'Importar RADIAN',              'Cargar archivos .xlsx de RADIAN/DIAN',                       'RADIAN',      'MEDIUM',  false),
  ('radian.read',                'Ver datos RADIAN',             'Leer el dataset importado',                                 'RADIAN',      'LOW',     false),

  ('documents.read',             'Ver documentos',               'Listar y consultar documentos',                             'DOCUMENTOS',  'LOW',     false),
  ('documents.export',           'Exportar documentos',          'Exportar documentos y reportes',                            'DOCUMENTOS',  'LOW',     false),

  ('reports.read',               'Ver reportes',                 'Reportería mensual, terceros e impuestos',                  'REPORTES',    'LOW',     false),
  ('reports.export',             'Exportar reportes',            'Descargar reportes',                                        'REPORTES',    'LOW',     false),

  ('issues.read',                'Ver validaciones',             'Consultar incidencias de importación',                      'VALIDACIONES','LOW',     false),
  ('issues.resolve',             'Resolver validaciones',        'Marcar incidencias como resueltas',                         'VALIDACIONES','MEDIUM',  false),

  ('company.read',               'Ver empresa',                  'Consultar datos y configuración de la empresa',             'EMPRESA',     'LOW',     false),
  ('company.update',             'Modificar empresa',            'Cambiar parámetros de la empresa',                          'EMPRESA',     'HIGH',    false),
  ('company.update_identity',    'Cambiar identificación',       'Cambiar NIT, dígito de verificación o razón social',        'EMPRESA',     'CRITICAL', true),

  ('settings.read',              'Ver configuración',            'Leer settings de la aplicación/empresa',                    'CONFIGURACION','LOW',    false),
  ('settings.write',             'Modificar configuración',      'Escribir settings de la aplicación/empresa',                'CONFIGURACION','MEDIUM', false),

  ('integrations.read',          'Ver integraciones',            'Consultar integraciones y su estado',                       'INTEGRACIONES','LOW',    false),
  ('integrations.configure',     'Configurar integraciones',     'Crear/editar integraciones y sus ajustes',                  'INTEGRACIONES','HIGH',   false),
  ('integrations.credentials.write', 'Modificar credenciales',   'Escribir o borrar credenciales de un proveedor',            'INTEGRACIONES','CRITICAL', true),
  ('integrations.test',          'Probar conexión',              'Ejecutar la prueba de conexión contra el proveedor',        'INTEGRACIONES','MEDIUM', false),
  ('integrations.enable',        'Habilitar integración',        'Activar una integración',                                   'INTEGRACIONES','HIGH',   false),
  ('integrations.disable',       'Deshabilitar integración',     'Desactivar una integración',                                'INTEGRACIONES','HIGH',   false),

  ('sync.read',                  'Ver sincronización',           'Consultar matches, corridas y conflictos',                  'SINCRONIZACION','LOW',  false),
  ('sync.configure',             'Configurar sincronización',    'Modificar políticas y rutas de sincronización',             'SINCRONIZACION','HIGH', false),
  ('sync.execute',               'Ejecutar sincronización',      'Disparar corridas de sincronización',                       'SINCRONIZACION','HIGH', false),
  ('sync.resolve_conflict',      'Resolver conflictos',          'Resolver conflictos de sincronización',                     'SINCRONIZACION','HIGH', false),

  ('users.read',                 'Ver usuarios',                 'Listar y consultar usuarios',                               'USUARIOS',    'LOW',     false),
  ('users.create',               'Crear usuarios',               'Invitar o crear usuarios',                                  'USUARIOS',    'HIGH',    false),
  ('users.update',               'Modificar usuarios',           'Editar nombre, estado y datos de usuarios',                 'USUARIOS',    'HIGH',    false),
  ('users.disable',              'Deshabilitar usuarios',        'Suspender o deshabilitar cuentas',                          'USUARIOS',    'CRITICAL', true),
  ('users.reactivate',           'Reactivar usuarios',           'Reactivar cuentas deshabilitadas',                          'USUARIOS',    'HIGH',    false),

  ('users.company.assign',       'Asignar empresas',             'Conceder acceso de un usuario a una empresa',               'USUARIOS',    'CRITICAL', true),
  ('users.company.remove',       'Quitar empresas',              'Revocar el acceso de un usuario a una empresa',             'USUARIOS',    'CRITICAL', true),

  ('users.roles.assign',         'Asignar roles',                'Asignar roles dentro de una empresa',                       'USUARIOS',    'CRITICAL', true),
  ('users.roles.remove',         'Quitar roles',                 'Quitar roles dentro de una empresa',                        'USUARIOS',    'CRITICAL', true),
  ('users.roles.assign_owner',   'Asignar rol OWNER',            'Conceder el rol OWNER (requiere permiso propio)',            'USUARIOS',    'CRITICAL', true),

  ('users.password.reset',       'Resetear contraseñas',         'Generar reset o contraseña temporal',                       'SEGURIDAD',   'CRITICAL', true),
  ('users.2fa.require',          'Exigir 2FA',                   'Marcar que un usuario debe usar 2FA',                       'SEGURIDAD',   'CRITICAL', true),
  ('users.2fa.reset',            'Resetear 2FA',                 'Invalidar el enrolamiento 2FA de un usuario',               'SEGURIDAD',   'CRITICAL', true),

  ('sessions.read',              'Ver sesiones',                 'Listar sesiones activas de un usuario',                     'SEGURIDAD',   'MEDIUM',  false),
  ('sessions.revoke',            'Revocar sesiones',             'Cerrar sesiones de un usuario',                             'SEGURIDAD',   'HIGH',    false),

  ('audit.read',                 'Ver auditoría',                'Consultar el registro de auditoría',                        'AUDITORIA',   'MEDIUM',  false)
ON CONFLICT (code) DO NOTHING;

/* ------------------------------------------------------------------ */
/* 13. Seed: roles preset del sistema                                  */
/*     (PLATFORM_ADMIN no es un rol de empresa: es users.platform_admin) */
/* ------------------------------------------------------------------ */

INSERT INTO roles (company_id, code, name, description, is_system, is_editable) VALUES
  (NULL, 'REPORT_IMPORTER',    'Importador RADIAN',  'Carga archivos RADIAN y consulta reportes básicos',              true, false),
  (NULL, 'ACCOUNTANT',         'Contador',           'Trabaja documentos, validaciones y reportes',                    true, false),
  (NULL, 'INTEGRATION_MANAGER','Gerente de integraciones', 'Configura integraciones con ERP y ejecuta sincronizaciones', true, false),
  (NULL, 'COMPANY_ADMIN',      'Administrador de empresa', 'Administra parámetros e identificación de la empresa',      true, false),
  (NULL, 'USER_ADMIN',         'Administrador de usuarios', 'Gestiona usuarios, empresas asignadas y roles',           true, false),
  (NULL, 'OWNER',              'Propietario',        'Todos los permisos de la empresa (siempre debe haber al menos uno)', true, false)
ON CONFLICT (code) WHERE company_id IS NULL DO NOTHING;

/* ------------------------------------------------------------------ */
/* 14. Seed: permisos por rol                                          */
/* ------------------------------------------------------------------ */

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (
  SELECT 'REPORT_IMPORTER'::varchar AS role_code, unnest(ARRAY[
    'radian.import','radian.read','documents.read','reports.read'
  ])::varchar AS permission_code
  UNION ALL
  SELECT 'ACCOUNTANT', unnest(ARRAY[
    'radian.import','radian.read','documents.read','documents.export',
    'reports.read','reports.export','issues.read','issues.resolve'
  ])
  UNION ALL
  SELECT 'INTEGRATION_MANAGER', unnest(ARRAY[
    'integrations.read','integrations.configure','integrations.credentials.write',
    'integrations.test','integrations.enable','integrations.disable',
    'sync.read','sync.configure','sync.execute','sync.resolve_conflict'
  ])
  UNION ALL
  SELECT 'COMPANY_ADMIN', unnest(ARRAY[
    'company.read','company.update','company.update_identity','settings.read','settings.write'
  ])
  UNION ALL
  SELECT 'USER_ADMIN', unnest(ARRAY[
    'users.read','users.create','users.update','users.disable','users.reactivate',
    'users.company.assign','users.company.remove',
    'users.roles.assign','users.roles.remove',
    'users.password.reset','users.2fa.require','users.2fa.reset',
    'sessions.read','sessions.revoke'
  ])
  UNION ALL
  SELECT 'OWNER', unnest(ARRAY[
    'radian.import','radian.read','documents.read','documents.export',
    'reports.read','reports.export','issues.read','issues.resolve',
    'company.read','company.update','company.update_identity',
    'settings.read','settings.write',
    'integrations.read','integrations.configure','integrations.credentials.write',
    'integrations.test','integrations.enable','integrations.disable',
    'sync.read','sync.configure','sync.execute','sync.resolve_conflict',
    'users.read','users.create','users.update','users.disable','users.reactivate',
    'users.company.assign','users.company.remove',
    'users.roles.assign','users.roles.remove','users.roles.assign_owner',
    'users.password.reset','users.2fa.require','users.2fa.reset',
    'sessions.read','sessions.revoke','audit.read'
  ])
) m
JOIN roles r ON r.company_id IS NULL AND r.code = m.role_code
JOIN permissions p ON p.code = m.permission_code
ON CONFLICT DO NOTHING;

/* ------------------------------------------------------------------ */
/* 15. updated_at                                                      */
/* ------------------------------------------------------------------ */

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER company_memberships_updated_at BEFORE UPDATE ON company_memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER roles_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
