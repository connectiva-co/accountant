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
│       ├── api/        Rutas HTTP y esquemas (zod)
│       ├── db/         Conexión, tipos Kysely, migrador, settings
│       ├── domain/     Texto, fechas, UID, hash, catálogos, impuestos
│       ├── import/     Pipeline RADIAN: spreadsheet → normalización → upsert
│       ├── reporting/  Recalculo de reportería mensual agregada
│       └── services/   Consultas (dataset en forma RADIAN para la UI)
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

## API

| Método y ruta              | Descripción                                                          |
| -------------------------- | -------------------------------------------------------------------- |
| `GET  /api/health`         | Estado del servicio                                                   |
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
```

Variables opcionales: `AUTO_MIGRATE=false` (no migrar al arrancar), `VITE_API_URL` (URL base del
frontend).

---

Desarrollado por [Connectiva](https://connectiva.co)
