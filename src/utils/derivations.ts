import type {
  AttentionItemData,
  RadianRecord,
  ViewId,
} from '../types/radian';
import { parseRecordDate, toISODate } from './period';
import { formatPercent } from './formatters';
import type { CompanyInfo } from '../config/company';

/* ------------------------------------------------------------------ */
/* Estados documentales                                                */
/* ------------------------------------------------------------------ */

export type EstadoKind = 'aprobado' | 'pendiente' | 'rechazado' | 'inconsistente';

export function classifyEstado(estado: string | undefined): EstadoKind {
  const e = (estado || '').toLowerCase();
  if (e.includes('rechaz')) return 'rechazado';
  if (e.includes('pendient') || e.includes('proceso') || e.includes('enviad')) return 'pendiente';
  if (e.includes('aprob') || e.includes('aceptad')) return 'aprobado';
  if (e.includes('inconsisten') || e.includes('advertenc')) return 'inconsistente';
  return 'inconsistente';
}

export interface StatusSummary {
  total: number;
  aprobados: number;
  pendientes: number;
  rechazados: number;
  inconsistencias: number;
}

export function statusSummary(records: RadianRecord[]): StatusSummary {
  const s: StatusSummary = { total: records.length, aprobados: 0, pendientes: 0, rechazados: 0, inconsistencias: 0 };
  for (const r of records) {
    const kind = classifyEstado(r.Estado);
    if (kind === 'aprobado') s.aprobados++;
    else if (kind === 'pendiente') s.pendientes++;
    else if (kind === 'rechazado') s.rechazados++;
    else s.inconsistencias++;
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Validaciones / calidad de datos                                     */
/* ------------------------------------------------------------------ */

export function isValidNit(value: string | number | undefined): boolean {
  if (value === undefined || value === null) return false;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 0) return false;
  return digits.length >= 6 && digits.length <= 10;
}

/* ------------------------------------------------------------------ */
/* Empresa a partir de la fuente RADIAN                                */
/* ------------------------------------------------------------------ */

const PLACEHOLDER_PARTIES = ['consumidor final', 'cliente final', 'genérico', 'publico en general'];
const PLACEHOLDER_NITS = new Set(['222222222222', '9999999999999', '0', '111111111']);

function normalizeNit(value: string | number | undefined): string | null {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim().replace(/\.0$/, '');
  if (!raw) return null;
  return raw;
}

function isPlaceholderName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return PLACEHOLDER_PARTIES.some((p) => n === p || n.startsWith(p));
}

export function deriveCompany(records: RadianRecord[]): CompanyInfo {
  const docsByNit = new Map<string, number>();
  const namesByNit = new Map<string, Map<string, number>>();

  for (const r of records) {
    const seen = new Set<string>();
    const sides: Array<[string | number | undefined, string | number | undefined]> = [
      [r['NIT Emisor'], r['Nombre Emisor']],
      [r['NIT Receptor'], r['Nombre Receptor']],
    ];
    for (const [nitRaw, nameRaw] of sides) {
      const nit = normalizeNit(nitRaw);
      if (!nit || PLACEHOLDER_NITS.has(nit)) continue;
      if (!seen.has(nit)) {
        seen.add(nit);
        docsByNit.set(nit, (docsByNit.get(nit) || 0) + 1);
      }
      const name = String(nameRaw || '').trim();
      if (!name || isPlaceholderName(name)) continue;
      let names = namesByNit.get(nit);
      if (!names) {
        names = new Map();
        namesByNit.set(nit, names);
      }
      names.set(name, (names.get(name) || 0) + 1);
    }
  }

  if (docsByNit.size === 0) return { name: '', nit: '' };

  const ranked = [...docsByNit.entries()]
    .map(([nit, docs]) => ({ nit, docs, hasName: (namesByNit.get(nit)?.size || 0) > 0 }))
    .sort((a, b) => b.docs - a.docs || Number(b.hasName) - Number(a.hasName) || a.nit.localeCompare(b.nit));

  const winner = ranked.find((c) => c.hasName) || ranked[0];
  const names = namesByNit.get(winner.nit);
  const bestName = names
    ? [...names.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0]
    : '';

  return { name: bestName, nit: winner.nit };
}

function isKnownType(tipo: string): boolean {
  const t = (tipo || '').toLowerCase();
  return (
    t.includes('factura') ||
    t.includes('nota de cr') ||
    t.includes('soporte') ||
    t.includes('nomina') ||
    t.includes('pos') ||
    t.includes('contingencia')
  );
}

function duplicateKey(r: RadianRecord): string {
  return [r['Tipo de documento'], r.Folio, r['Fecha Emisión'], r.Total].join('|');
}

export function findDuplicates(records: RadianRecord[]): Set<string> {
  const seen = new Map<string, number>();
  for (const r of records) {
    const k = duplicateKey(r);
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const dups = new Set<string>();
  for (const [k, count] of seen) if (count > 1) dups.add(k);
  return dups;
}

export interface QualityReport {
  procesados: number;
  validados: number;
  validadosPct: number;
  aprobados: number;
  requierenRevision: number;
  duplicados: number;
  sinFecha: number;
  nitInvalidos: number;
}

export function qualityReport(records: RadianRecord[]): QualityReport {
  const dups = findDuplicates(records);
  let aprobados = 0;
  let sinCufe = 0;
  let duplicados = 0;
  let sinFecha = 0;
  let nitInvalidos = 0;

  for (const r of records) {
    if (classifyEstado(r.Estado) === 'aprobado') aprobados++;
    const tipo = (r['Tipo de documento'] || '').toLowerCase();
    if ((tipo.includes('factura') || tipo.includes('nota de cr')) && !r['CUFE/CUDE']) sinCufe++;
    if (dups.has(duplicateKey(r))) duplicados++;
    if (!parseRecordDate(r['Fecha Emisión'])) sinFecha++;
    if (!isValidNit(r['NIT Emisor'])) nitInvalidos++;
    if (!isValidNit(r['NIT Receptor']) && String(r['NIT Receptor']) !== '') nitInvalidos++;
  }

  const revisión = records.length - aprobados + sinCufe;
  return {
    procesados: records.length,
    validados: aprobados,
    validadosPct: records.length ? (aprobados / records.length) * 100 : 0,
    aprobados,
    requierenRevision: revisión,
    duplicados,
    sinFecha,
    nitInvalidos,
  };
}

/* ------------------------------------------------------------------ */
/* Requiere atención                                                    */
/* ------------------------------------------------------------------ */

export function routeForRecords(records: RadianRecord[], fallback: ViewId = 'ventas'): ViewId {
  const score: Record<string, number> = { ventas: 0, compras: 0, nc: 0, dse: 0, nomina: 0 };
  for (const r of records) {
    const t = (r['Tipo de documento'] || '').toLowerCase();
    const g = (r['Grupo'] || '').toLowerCase();
    if (t.includes('factura') && g === 'emitido') score.ventas++;
    else if (t.includes('factura') && g === 'recibido') score.compras++;
    else if (t.includes('nota de cr')) score.nc++;
    else if (t.includes('soporte')) score.dse++;
    else if (t.includes('nomina') || t.includes('pos')) score.nomina++;
  }
  const order: ViewId[] = ['ventas', 'compras', 'nc', 'dse', 'nomina'];
  let best: ViewId = fallback;
  let bestScore = -1;
  for (const v of order) {
    if (score[v] > bestScore) {
      best = v;
      bestScore = score[v];
    }
  }
  return best;
}

export function attentionItems(records: RadianRecord[]): AttentionItemData[] {
  const items: AttentionItemData[] = [];
  const dups = findDuplicates(records);

  const rechazados = records.filter((r) => classifyEstado(r.Estado) === 'rechazado');
  if (rechazados.length) {
    items.push({
      id: 'rechazados',
      label: `${rechazados.length} ${rechazados.length === 1 ? 'documento rechazado' : 'documentos rechazados'} por la DIAN`,
      count: rechazados.length,
      severity: 'error',
      target: { view: routeForRecords(rechazados), filters: { onlyRejected: true } },
    });
  }

  const pendientes = records.filter((r) => classifyEstado(r.Estado) === 'pendiente');
  if (pendientes.length) {
    items.push({
      id: 'pendientes',
      label: `${pendientes.length} ${pendientes.length === 1 ? 'documento pendiente' : 'documentos pendientes'} de validación`,
      count: pendientes.length,
      severity: 'warning',
      target: { view: routeForRecords(pendientes), filters: { onlyPending: true } },
    });
  }

  const sinRecepcion = records.filter((r) => !r['Fecha Recepción']);
  if (sinRecepcion.length) {
    items.push({
      id: 'sin-conciliar',
      label: `${sinRecepcion.length} ${sinRecepcion.length === 1 ? 'documento sin fecha' : 'documentos sin fecha'} de recepción`,
      count: sinRecepcion.length,
      severity: 'warning',
      target: { view: routeForRecords(sinRecepcion) },
    });
  }

  const incompletos = records.filter(
    (r) =>
      !String(r['Nombre Receptor'] || '').trim() ||
      !String(r['Nombre Emisor'] || '').trim() ||
      !isValidNit(r['NIT Receptor']) ||
      !isValidNit(r['NIT Emisor'])
  );
  if (incompletos.length) {
    items.push({
      id: 'terceros',
      label: `${incompletos.length} ${incompletos.length === 1 ? 'tercero con información incompleta' : 'terceros con información incompleta'}`,
      count: incompletos.length,
      severity: 'warning',
      target: { view: 'terceros' },
    });
  }

  const duplicados = records.filter((r) => dups.has(duplicateKey(r)));
  if (duplicados.length) {
    items.push({
      id: 'duplicados',
      label: `${duplicados.length} posible ${duplicados.length === 1 ? 'documento duplicado' : 'documentos duplicados'}`,
      count: duplicados.length,
      severity: 'warning',
      target: { view: routeForRecords(duplicados) },
    });
  }

  const sinClasificar = records.filter((r) => !isKnownType(r['Tipo de documento']));
  if (sinClasificar.length) {
    items.push({
      id: 'sin-clasificar',
      label: `${sinClasificar.length} ${sinClasificar.length === 1 ? 'documento pendiente' : 'documentos pendientes'} de clasificación`,
      count: sinClasificar.length,
      severity: 'neutral',
      target: { view: routeForRecords(sinClasificar) },
    });
  }

  const inconsistencias = records.filter((r) => classifyEstado(r.Estado) === 'inconsistente');
  if (inconsistencias.length) {
    items.push({
      id: 'inconsistencias',
      label: `${inconsistencias.length} ${inconsistencias.length === 1 ? 'documento con inconsistencias' : 'documentos con inconsistencias'}`,
      count: inconsistencias.length,
      severity: 'warning',
      target: { view: routeForRecords(inconsistencias), filters: {} },
    });
  }

  return items;
}

/* ------------------------------------------------------------------ */
/* Terceros                                                            */
/* ------------------------------------------------------------------ */

export type ThirdPartyKind = 'cliente' | 'proveedor' | 'empleado' | 'otro';

export interface ThirdPartyProfile {
  nit: string;
  name: string;
  kind: ThirdPartyKind;
  documentos: number;
  total: number;
  iva: number;
  lastDate: string | null;
}

export function buildThirdParties(records: RadianRecord[]): ThirdPartyProfile[] {
  const map = new Map<string, ThirdPartyProfile>();

  const push = (
    nit: string | number,
    name: string,
    kind: ThirdPartyKind,
    total: number,
    iva: number,
    date: string | undefined
  ) => {
    const key = `${kind}:${String(nit).trim()}`;
    const existing = map.get(key);
    if (existing) {
      existing.documentos += 1;
      existing.total += total;
      existing.iva += iva;
      if (date && (!existing.lastDate || date > existing.lastDate)) existing.lastDate = date;
    } else {
      map.set(key, {
        nit: String(nit),
        name: (name || 'Sin nombre').trim(),
        kind,
        documentos: 1,
        total,
        iva,
        lastDate: date || null,
      });
    }
  };

  for (const r of records) {
    const tipo = (r['Tipo de documento'] || '').toLowerCase();
    const grupo = (r['Grupo'] || '').toLowerCase();
    const fecha = r['Fecha Emisión'];

    if (tipo.includes('factura') && grupo === 'emitido') {
      push(r['NIT Receptor'], r['Nombre Receptor'], 'cliente', r.Total, r.IVA || 0, fecha);
    } else if ((tipo.includes('factura') && grupo === 'recibido') || tipo.includes('pos')) {
      push(r['NIT Emisor'], r['Nombre Emisor'], 'proveedor', r.Total, r.IVA || 0, fecha);
    } else if (tipo.includes('nomina')) {
      push(r['NIT Receptor'], r['Nombre Receptor'], 'empleado', r.Total, r.IVA || 0, fecha);
    } else if (tipo.includes('nota de cr')) {
      const kind: ThirdPartyKind = grupo === 'emitido' ? 'cliente' : 'proveedor';
      const nit = grupo === 'emitido' ? r['NIT Receptor'] : r['NIT Emisor'];
      const name = grupo === 'emitido' ? r['Nombre Receptor'] : r['Nombre Emisor'];
      push(nit, name, kind, -Math.abs(r.Total), -(r.IVA || 0), fecha);
    } else if (tipo.includes('soporte')) {
      push(r['NIT Receptor'], r['Nombre Receptor'], 'otro', r.Total, r.IVA || 0, fecha);
    }
  }

  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

/* ------------------------------------------------------------------ */
/* Ranking de clientes y proveedores                                   */
/* ------------------------------------------------------------------ */

export interface PartyTotal {
  nit: string;
  name: string;
  total: number;
  count: number;
}

export function topParties(records: RadianRecord[], side: 'cliente' | 'proveedor', limit = 6): PartyTotal[] {
  const map = new Map<string, PartyTotal>();
  for (const r of records) {
    const tipo = (r['Tipo de documento'] || '').toLowerCase();
    const grupo = (r['Grupo'] || '').toLowerCase();
    const isFactura = tipo.includes('factura');
    const isNC = tipo.includes('nota de cr');

    if (side === 'cliente') {
      if ((isFactura || isNC) && grupo === 'emitido') {
        const nit = String(r['NIT Receptor']);
        const cur = map.get(nit) || { nit, name: r['Nombre Receptor'], total: 0, count: 0 };
        cur.total += isNC ? -Math.abs(r.Total) : r.Total;
        cur.count += 1;
        map.set(nit, cur);
      }
    } else if ((isFactura && grupo === 'recibido') || tipo.includes('pos') || (isNC && grupo === 'recibido')) {
      const nit = String(r['NIT Emisor']);
      const cur = map.get(nit) || { nit, name: r['Nombre Emisor'], total: 0, count: 0 };
      cur.total += isNC ? -Math.abs(r.Total) : r.Total;
      cur.count += 1;
      map.set(nit, cur);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Serie Ventas vs Compras                                             */
/* ------------------------------------------------------------------ */

export interface SeriesPoint {
  label: string;
  ventas: number;
  compras: number;
}

export function buildSalesPurchasesSeries(records: RadianRecord[]): { mode: 'month' | 'day'; data: SeriesPoint[] } {
  const monthly = new Map<string, SeriesPoint>();
  const daily = new Map<string, SeriesPoint>();
  const months = new Set<string>();

  for (const r of records) {
    const tipo = (r['Tipo de documento'] || '').toLowerCase();
    if (!tipo.includes('factura')) continue;
    const d = parseRecordDate(r['Fecha Emisión']);
    if (!d) continue;

    const mk = toISODate(d);
    const monthKey = mk.substring(0, 7);
    months.add(monthKey);

    const monthPoint = monthly.get(monthKey) || { label: monthKey, ventas: 0, compras: 0 };
    const dayPoint = daily.get(mk) || { label: mk, ventas: 0, compras: 0 };

    const target = (r['Grupo'] || '').toLowerCase() === 'emitido' ? 'ventas' : 'compras';
    monthPoint[target] += r.Total;
    dayPoint[target] += r.Total;

    monthly.set(monthKey, monthPoint);
    daily.set(mk, dayPoint);
  }

  if (months.size >= 3) {
    const data = Array.from(monthly.values())
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(-6)
      .map((p) => ({
        label: new Date(p.label + '-01T00:00:00').toLocaleDateString('es-CO', { month: 'short', year: '2-digit' }),
        ventas: p.ventas,
        compras: p.compras,
      }));
    return { mode: 'month', data };
  }

  const data = Array.from(daily.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(-45)
    .map((p) => {
      const d = fromISOLocal(p.label);
      return {
        label: `${d.getDate()}/${d.getMonth() + 1}`,
        ventas: p.ventas,
        compras: p.compras,
      };
    });
  return { mode: 'day', data };
}

function fromISOLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/* ------------------------------------------------------------------ */
/* Observaciones                                                       */
/* ------------------------------------------------------------------ */

export function buildObservations(
  records: RadianRecord[],
  prevRecords: RadianRecord[],
  prevPeriodLabel: string
): string[] {
  const out: string[] = [];

  const sumBy = (rows: RadianRecord[], pick: 'ventas' | 'compras') =>
    rows.reduce((acc, r) => {
      const tipo = (r['Tipo de documento'] || '').toLowerCase();
      const grupo = (r['Grupo'] || '').toLowerCase();
      if (!tipo.includes('factura')) return acc;
      if (pick === 'ventas' && grupo === 'emitido') return acc + r.Total;
      if (pick === 'compras' && grupo === 'recibido') return acc + r.Total;
      return acc;
    }, 0);

  const clients = topParties(records, 'cliente', 10);
  const ventasTotal = clients.reduce((acc, c) => acc + Math.max(0, c.total), 0);
  if (clients.length >= 2 && ventasTotal > 0) {
    const share = ((Math.max(0, clients[0].total) + Math.max(0, clients[1].total)) / ventasTotal) * 100;
    if (share >= 50) {
      out.push(
        `El ${formatPercent(share)} de las ventas está concentrado en ${clients[0].name} y ${clients[1].name}.`
      );
    }
  }

  const comprasActual = sumBy(records, 'compras');
  const comprasPrev = sumBy(prevRecords, 'compras');
  if (comprasPrev > 0 && comprasActual > 0) {
    const delta = ((comprasActual - comprasPrev) / comprasPrev) * 100;
    if (Math.abs(delta) >= 1) {
      out.push(
        `Las compras ${delta > 0 ? 'aumentaron' : 'disminuyeron'} ${formatPercent(Math.abs(delta))} frente a ${prevPeriodLabel}.`
      );
    }
  }

  const ventasActual = sumBy(records, 'ventas');
  const ventasPrev = sumBy(prevRecords, 'ventas');
  if (ventasPrev > 0 && ventasActual > 0) {
    const delta = ((ventasActual - ventasPrev) / ventasPrev) * 100;
    if (Math.abs(delta) >= 1) {
      out.push(
        `Las ventas ${delta > 0 ? 'aumentaron' : 'disminuyeron'} ${formatPercent(Math.abs(delta))} frente a ${prevPeriodLabel}.`
      );
    }
  }

  const pendientes = attentionItems(records);
  if (pendientes.length) {
    out.push(
      `Existen ${pendientes.reduce((a, i) => a + i.count, 0)} documentos que requieren revisión en el periodo.`
    );
  } else {
    out.push('No hay documentos pendientes de revisión en el periodo seleccionado.');
  }

  return out;
}
