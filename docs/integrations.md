# Integraciones y sincronización

Accountant se conecta a ERPs contables (Siigo, World Office, y cualquier otro) a través de una
abstracción: el core **nunca** importa un SDK concreto. Todo pasa por `IntegrationAdapter` +
`IntegrationManager`, y cada provider entra solo por su adapter registrado.

```
Configuración → Integraciones (UI)
   │  campos/secretos/capacidades vienen del catálogo del adapter
   ▼
API  PUT /api/companies/:companyId/integrations/:provider
   │  settings validados con el schema del adapter
   │  credenciales cifradas con AES-256-GCM (SECRETS_MASTER_KEY)
   ▼
IntegrationManager.getClient(companyId, provider)   ← cache + single-flight
   │
   ├─ matching.ts   matchDocument / recheckMatches   (RADIAN ↔ ERP)
   └─ sync/engine   runThirdPartySync               (lectura/escritura de terceros)
```

## Piezas

| Archivo | Responsabilidad |
| ------- | --------------- |
| `server/src/integrations/adapter.ts` | Contrato `IntegrationAdapter`, `IntegrationError`, tipos de resultado |
| `server/src/integrations/capabilities.ts` | Plantilla `${RECURSO}_${OPERACIÓN}` y helper de capacidades |
| `server/src/integrations/registry.ts` | Registro de adapters (`SIIGO`, `WORLD_OFFICE`) |
| `server/src/integrations/store.ts` | Persistencia: integraciones, settings, credenciales cifradas |
| `server/src/integrations/manager.ts` | Cliente cacheado, `testConnection`, invalidación, auditoría |
| `server/src/integrations/matching.ts` | Puntuación, estados de match y persistencia de coincidencias |
| `server/src/integrations/lookup.ts` | Helpers compartidos de lookup/paginación |
| `server/src/integrations/sync/engine.ts` | Motor de sincronización (por ahora: terceros) |
| `server/src/integrations/providers/*.ts` | Siigo y World Office (los únicos que tocan un SDK) |
| `server/src/settings/` | Esquema/validación de parámetros (scope + clave) |

## Capacidades: lo que está implementado, no lo que el provider permite

`capability` describe operaciones que **este adapter implementa hoy**:

- Siigo: `DOCUMENT_LOOKUP_READ`, `THIRD_PARTIES_READ`, `THIRD_PARTIES_WRITE`.
- World Office: `DOCUMENT_LOOKUP_READ`, `THIRD_PARTIES_READ` (solo lectura).

Si mañana se implementa `createInvoice`, se agrega `SALES_INVOICES_WRITE` y el SyncEngine empieza
a ofrecer esa ruta automáticamente. Anunciar capacidades no implementadas haría que la UI mienta
y que el motor intente rutas muertas.

Regla para agregar un provider nuevo:

1. Implementar el adapter (`provider/nuevo.ts`) con `settingsSchema`, `credentialsSchema`,
   `createClient`, `testConnection`, `searchDocuments` (y opcionalmente `listThirdParties` /
   `createThirdParty`).
2. Declarar **solo** las capacidades realmente implementadas y `syncResources` acorde.
3. Registrarlo en `registry.ts` y como fila en `integration_providers` (migración).

## Credenciales

- Se guardan cifradas (AES-256-GCM) en `integration_secrets.encrypted_payload`; la maestra vive en
  `SECRETS_MASTER_KEY` (32 bytes, fuera de la base de datos) y se rota con `SECRETS_KEY_VERSION`.
- Nunca se devuelven en una respuesta: `GET` solo expone `has_credentials`, y el catálogo expone
  el **nombre** del campo (p. ej. `access_key`), no su valor.
- El cifrado se redacta también en logs (`redactSecrets`) y en `audit_log`.
- `POST .../test` falla localmente (sin red) si faltan credenciales: `SIN_CREDENCIALES`.

## Matching RADIAN ↔ ERP

Para cada documento local se construye una consulta (`buildLookupQuery`: CUFE, NIT de la
contraparte, prefijo/folio, fecha, total) y se puntuán los candidatos devueltos por el ERP:

| Señal | Puntos |
| ----- | ------ |
| CUFE idéntico o `external_id` idéntico | 1.0 (match directo) |
| NIT igual | 0.40 |
| prefijo o número de folio igual | 0.35 |
| fecha de emisión igual | 0.15 |
| total igual (±0.01) | 0.15 |

- `MATCH_THRESHOLD = 0.85`: por debajo no hay match.
- `AMBIGUITY_MARGIN = 0.05`: dos candidatos casi empatados ⇒ `AMBIGUOUS`, nunca se elige al azar.
- Un candidato **solo con NIT** queda ambiguo (0.4), jamás `MATCHED`.
- **`ERROR ≠ NOT_FOUND`**: token vencido, 429 o timeout se persisten como `ERROR`; "no pude
  consultar" no es "no existe".
- Un error de provider nunca borra un match previo.

Estados persistidos en `document_integration_matches`
(`NOT_CHECKED | MATCHED | NOT_FOUND | AMBIGUOUS | ERROR`), con `dry_run` para calcular sin escribir.

## Sincronización

`POST /api/companies/:companyId/sync/run` (por ahora solo `THIRD_PARTIES`):

1. Lee las rutas vigentes (`sync_routes`, o fallback: todas las integraciones habilitadas en modo
   solo-lectura).
2. `listThirdParties` en cada integración de lectura → `ensureThirdParty` local.
3. Si existe una ruta de escritura **y** el adapter declara `THIRD_PARTIES_WRITE`, sube los
   terceros locales faltantes al ERP.
4. Duplicados con distinto contenido ⇒ `sync_conflicts` (estrategia de la política: `SOURCE_WINS`,
   `TARGET_WINS`, …) resolubles desde la UI.
5. Cada corrida deja una fila en `integration_runs` y un evento en `audit_log`.

## API

| Método y ruta | Descripción |
| ------------- | ----------- |
| `GET  /api/companies/:companyId/integrations` | Integraciones + catálogo (fields, capabilities) |
| `GET  /api/companies/:companyId/integrations/:provider` | Detalle de una integración |
| `PUT  /api/companies/:companyId/integrations/:provider` | Crea/actualiza settings, credenciales, enable |
| `POST /api/companies/:companyId/integrations/:provider/test` | Prueba de conexión (auditoría) |
| `GET  /api/companies/:companyId/matches` | Estado de matching (`status`, `limit`) |
| `POST /api/companies/:companyId/documents/:id/match` | Match puntual de un documento |
| `POST /api/companies/:companyId/matches/recheck` | Revisión por lote |
| `GET  /api/companies/:companyId/sync/policies` | Políticas y rutas de sincronización |
| `POST /api/companies/:companyId/sync/run` | Ejecuta/simula la sincronización |
| `GET  /api/companies/:companyId/sync/conflicts` | Conflictos abiertos |
| `POST /api/companies/:companyId/sync/conflicts/:id/resolve` | Resuelve un conflicto |
| `GET  /api/companies/:companyId/integration-runs` | Historial de corridas |

## Límites conocidos

- **Sin autenticación**: el aislamiento es por `company_id` validado en cada ruta; no hay login ni
  JWT. Antes de exponer la API se debe agregar autenticación/autorización.
- **World Office es solo lectura**: `crearTercero`/`crearFacturaVenta`/`crearCompra` del SDK exigen
  catálogos (ciudad, tipo de tercero, clasificación impositiva) no disponibles en la v1; el adapter
  no los declara como capacidad. Además, el `swagger.json` documenta `POST /documentos/listarDocumentoVenta`
  mientras el SDK expone `GET /documentos/consultarDocumentos`, y no devuelve totales: el matching
  de WO es más débil y se normaliza la respuesta (`extractItems`).
- **Ventana de fechas**: Siigo filtra por fecha de *creación* (`created_start/created_end`), no por
  fecha de emisión; se usa `created_start = emisión − ventana` como cota segura y el filtrado fino
  se hace localmente.
- **Paginación**: Siigo expone `page/page_size/total_results` (se corta cuando `results.length <
  page_size`); el bucle está topeado (~30-40 páginas) para evitar consultas interminables.
- **Vista de recursos**: solo `THIRD_PARTIES` está implementado de punta a punta; el resto de
  recursos quedan para futuras iteraciones.

## Pruebas

```bash
cd server
npm test   # unit (matching, settings) + integración (aislamiento, secretos)
```

- `tests/unit/matching.test.ts`: umbrales, ambigüedad y `ERROR ≠ NOT_FOUND` con un adapter falso.
- `tests/unit/settings.test.ts`: scopes/claves/tipos de `settings`.
- `tests/integration/isolation.test.ts`: aislamiento MP NET ↔ JGV, secretos ausentes en
  respuestas/auditoría, y errores tipados por ruta.
