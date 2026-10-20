# Accountant — Facturación electrónica DIAN (RADIAN)

Aplicación de contabilidad e impuestos sobre facturación electrónica colombiana: carga de
exportaciones **RADIAN / DIAN**, KPIs fiscales, conciliación de IVA, terceros, obligaciones y
reportes, ahora con **base de datos persistente y auditable**.

## Arquitectura

```
accountant/
├── src/            Frontend React + TypeScript + Tailwind (Vite)
├── server/         API y persistencia (Fastify + Kysely + PostgreSQL)
│   ├── migrations/ Migraciones SQL aplicadas en orden (inmutables)
│   └── src/
│       ├── api/            Rutas HTTP y esquemas (zod)
│       ├── db/             Conexión, tipos Kysely, migrador
│       ├── domain/         Texto, fechas, UID, hash, catálogos, impuestos
│       ├── import/         Pipeline RADIAN: spreadsheet → normalización → upsert
│       ├── integrations/   Adaptadores de ERP (Siigo, World Office), matching y sync
│       ├── reporting/      Recalculo de reportería mensual agregada
│       ├── services/       Consultas (dataset en forma RADIAN para la UI)
│       └── settings/       Esquema y validación de parámetros por empresa
└── src/data/       Datos demo de referencia (sampleRadian.json, 356 filas)
```

El frontend no depende de la base: si el servidor no responde, la aplicación sigue funcionando
con los datos demo locales (**degradation elegante**). La API expone `GET /api/dataset` en la
misma forma RADIAN del archivo original, de modo que la capa de derivación existente
(`radianEngine`, `derivations`, `period`) no cambió.

## Inicio rápido

```bash
npm install
cd server && npm install
cd ..

# 1) Base de datos (copia server/.env.example a server/.env y ajusta DATABASE_URL)
cp server/.env.example server/.env
cd server && npm run migrate && npm run seed && cd ..

# 2) API (puerto 3001)
cd server && npm run dev

# 3) Frontend (puerto 3000, en otra terminal)
npm run dev
```

La URL de la API se configura con `VITE_API_URL` (por defecto `http://localhost:3001`).

## Comandos

Frontend:

| Comando           | Descripción                              |
| ----------------- | ---------------------------------------- |
| `npm run dev`     | Servidor de desarrollo Vite (puerto 3000) |
| `npm run build`   | Typecheck + build de producción          |

Servidor (`cd server`):

| Comando               | Descripción                                                    |
| --------------------- | -------------------------------------------------------------- |
| `npm run dev`         | API con recarga (tsx watch)                                    |
| `npm run start`       | API en modo producción                                         |
| `npm run migrate`     | Aplica migraciones pendientes (transaccional, checksum verificado) |
| `npm run migrate:status` | Estado y checksum de cada migración                          |
| `npm run seed`        | Catálogos de tipos de documento, impuestos y configuración     |
| `npm run import -- <archivo.xlsx>` | Importación desde la línea de comandos              |
| `npm run typecheck`   | `tsc --noEmit` (incluye pruebas)                               |
| `npm test`            | Pruebas unitarias e integración (usa `TEST_DATABASE_URL`)      |

## Autenticación y acceso

Sesión por cookies httpOnly (`acc_session`, `acc_refresh`, `acc_csrf`) con rotación de refresh,
CSRF por header `x-csrf-token` y bloqueo por intentos fallidos. El primer OWNER se crea al
arrancar (bootstrap) y todos los usuarios creados desde la UI reciben una **contraseña temporal**
(`must_change_password = true`): al iniciar sesión la aplicación muestra una pantalla obligatoria
de cambio de contraseña antes de entrar.

- **Roles preset** (del sistema, no editables): `OWNER`, `COMPANY_ADMIN`, `USER_ADMIN`,
  `ACCOUNTANT`, `INTEGRATION_MANAGER`, `REPORT_IMPORTER`; además existen roles personalizados por
  empresa. Cada empresa tiene sus `role_permissions`; los usuarios ven los datos de cada empresa con
  los permisos propios de esa empresa (`GET /api/me` devuelve `companies[]` con `roles` y
  `permissions` por empresa).
- **Permisos críticos** (`users.disable`, `users.company.*`, `users.roles.*`,
  `users.password.reset`, `users.2fa.*`) exigen **step-up**: la contraseña debe haberse
  confirmado en los últimos 10 minutos (si no, `401 PASO_REQUERIDO`; en la práctica, un login
  reciente basta).
- La UI de administración vive en **Usuarios y acceso** (gated por `users.read`): pestañas
  Usuarios / Roles y permisos / Seguridad.

## API

| Método y ruta              | Descripción                                                          |
| -------------------------- | -------------------------------------------------------------------- |
| `GET  /api/health`         | Estado del servicio                                                   |
| `POST /api/auth/login`     | Login (cookies de sesión; `429` tras 10 fallos)                       |
| `POST /api/auth/refresh`   | Rota la sesión/csrf                                                   |
| `POST /api/auth/logout`    | Cierra la sesión                                                      |
| `GET  /api/auth/csrf`      | Token CSRF inicial                                                    |
| `GET  /api/me`             | Identidad + empresas accesibles con roles/permisos + csrf             |
| `POST /api/auth/change-password` | Cambio de contraseña (actual + nueva; obligatorio si `must_change_password`) |
| `POST /api/auth/step-up`   | Reconfirma contraseña para permisos críticos                          |
| `GET/POST /api/users`      | Listado y creación de usuarios (devuelve `temporary_password`)        |
| `GET/PUT /api/users/:id`   | Detalle y edición (solo `full_name`)                                  |
| `POST /api/users/:id/disable` · `/reactivate` · `/reset-password` | Estado de cuenta y contraseña temporal (revoca sesiones) |
| `GET/POST/DELETE /api/users/:id/companies[/:companyId]` | Membresías por empresa (`/disable`, `/reactivate`) |
| `GET/POST/PUT /api/companies/:companyId/roles` | Roles de la empresa (los preset son de solo lectura)       |
| `POST/DELETE /api/companies/:companyId/users/:userId/roles/:roleId` | Asignar/quitar rol |
| `GET  /api/users/:id/sessions` · `POST .../revoke` · `POST .../revoke-all` | Sesiones activas y revocación |
| `POST /api/users/:id/mfa/require` · `/reset` | 2FA: `501 MFA_NO_DISPONIBLE` (Fase 4)                    |
| `GET  /api/admin/companies` | Empresas administrables por el actor (con sus permisos)              |
| `GET  /api/permissions`     | Catálogo de permisos                                                  |
| `GET  /api/companies`      | Empresas registradas                                                  |
| `GET  /api/dataset`        | Documentos en forma RADIAN (alimenta la UI)                           |
| `POST /api/imports`        | Importación multipart (`file`): idempotente por SHA-256 del archivo   |
| `GET  /api/imports`        | Historial de importaciones                                            |
| `GET  /api/imports/:id`    | Detalle de una importación (conteos y filas rechazadas)               |
| `GET  /api/documents`      | Listado con filtros (`company_id`, fechas, dirección, tipo, búsqueda) |
| `GET  /api/documents/:id`  | Detalle: impuestos, versiones, historial de estados, incidencias      |
| `GET  /api/issues`         | Validaciones (`open=true` para las pendientes)                        |
| `POST /api/issues/:id/resolve` | Marca una incidencia como resuelta (auditable)                   |
| `GET  /api/settings`       | Configuración efectiva (`scope.key`)                                  |
| `PUT  /api/settings`       | Crea o actualiza un valor de configuración                            |
| `GET  /api/reporting/monthly`      | Reportería mensual agregada (`from`/`to` = `AAAA-MM`)         |
| `GET  /api/reporting/counterparties` | Agregado por tercero (`role`, `search`, `limit`)             |
| `GET  /api/reporting/taxes`        | Agregado por impuesto (`from`/`to` = `AAAA-MM`)               |
| `GET  /api/events`         | Eventos (Application response)                                        |
| `GET  /api/companies/:id/integrations` | Integraciones + catálogo (fields, capabilities)     |
| `PUT  /api/companies/:id/integrations/:provider` | Alta/edición de settings y credenciales cifradas |
| `POST /api/companies/:id/integrations/:provider/test` | Prueba de conexión (auditoría)            |
| `GET  /api/companies/:id/matches` | Estado de matching RADIAN ↔ ERP                              |
| `POST /api/companies/:id/matches/recheck` | Revisión por lote contra el ERP                       |
| `POST /api/companies/:id/sync/run` | Sincronización de terceros (acepta `dry_run`)              |
| `GET  /api/companies/:id/sync/conflicts` | Conflictos abiertos                                 |

Errores: `{ "error": { "code": "...", "message": "..." } }` con estado HTTP apropiado
(`400` consulta inválida, `404` no encontrado, `422` archivo/reglas de negocio).

## Reglas de datos

- **Idempotencia**: mismo archivo + misma empresa ⇒ no se reprocesa (`SHA-256` del archivo).
- **Determinismo**: `source_hash` del documento normalizado ⇒ `INSERT` / `UNCHANGED` / `UPDATE`.
- **Auditoría**: `document_versions` (versionado completo), `document_status_history` (cambios de
  estado), `third_party_history` (SCD2 de terceros), `audit_log`.
- **Multitenancia**: `company_id` en todas las tablas; la dirección (`ISSUED`/`RECEIVED`) se
  decide por el NIT de la empresa, no por la etiqueta del archivo.
- **Impuestos normalizados**: `tax_types` + `document_taxes`; la base o la tarifa quedan en `NULL`
  cuando RADIAN no las informa (nunca se inventan valores).
- **Reportería derivada**: `refresh_reporting_month(company, año, mes)` recalcula solo los
  periodos afectados; se puede reconstruir en cualquier momento desde los documentos.
- **Histórico**: nunca se borra; se marca `is_active = false` y se conserva la versión anterior.

## Pruebas

```bash
cd server
TEST_DATABASE_URL=postgresql://.../accountant_test npm test   # ya definida en server/.env
```

La suite de integración **recrea el esquema** de `accountant_test` (exige que la URL contenga
`test`): importa las 356 filas de referencia, verifica idempotencia, versionado, reportería y la
**paridad exacta de los KPIs del frontend** calculados desde la base contra los calculados desde
el archivo original.

## Configuración

`server/.env` (nunca se commitea; `.env.example` es la plantilla):

```
DATABASE_URL=postgresql://user:password@host:5432/accountant
TEST_DATABASE_URL=postgresql://user:password@host:5432/accountant_test
PORT=3001
LOG_LEVEL=info
SECRETS_MASTER_KEY=<32 bytes en base64>   # cifra credenciales de integraciones
SECRETS_KEY_VERSION=1
```

Genera la maestra con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Variables opcionales: `AUTO_MIGRATE=false` (no migrar al arrancar), `VITE_API_URL` (URL base del
frontend).

## Integraciones (ERP)

La conexión con Siigo, World Office y futuros ERPs vive detrás de un adaptador genérico:
capacidades declaradas por adapter, credenciales cifradas (AES-256-GCM), matching
RADIAN ↔ ERP con estados (`MATCHED` / `NOT_FOUND` / `AMBIGUOUS` / `ERROR`) y sincronización de
terceros con conflictos auditables. La UI está en **Configuración → Integraciones y
sincronización**. Detalle, límites y guía para agregar un provider: [`docs/integrations.md`](docs/integrations.md).

---

Desarrollado por [Connectiva](https://connectiva.co)
