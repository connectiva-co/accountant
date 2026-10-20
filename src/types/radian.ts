export interface RadianRecord {
  'Tipo de documento': string;
  'CUFE/CUDE'?: string;
  'Folio': string | number;
  'Prefijo'?: string;
  'Divisa'?: string;
  'Forma de Pago'?: string;
  'Medio de Pago'?: string;
  'Fecha Emisión': string;
  'Fecha Recepción'?: string;
  'NIT Emisor': string | number;
  'Nombre Emisor': string;
  'NIT Receptor': string | number;
  'Nombre Receptor': string;
  'IVA': number;
  'ICA'?: number;
  'IC'?: number;
  'INC': number;
  'Timbre'?: number;
  'INC Bolsas'?: number;
  'IN Carbono'?: number;
  'IN Combustibles'?: number;
  'IC Datos'?: number;
  'ICL'?: number;
  'INPP'?: number;
  'IBUA'?: number;
  'ICUI'?: number;
  'Rete IVA'?: number;
  'Rete Renta'?: number;
  'Rete ICA'?: number;
  'Total': number;
  'Estado': string;
  'Grupo': 'Emitido' | 'Recibido' | string;
  // Calculated fields
  baseCalculada?: number;
  totalImpuestos?: number;
  id?: string;
  match_status?: 'NOT_CHECKED' | 'MATCHED' | 'NOT_FOUND' | 'AMBIGUOUS' | 'ERROR';
  match_error?: string | null;
  external_erp_id?: string | null;
  external_erp_number?: string | null;
}

export interface FinancialKPIs {
  totalVentasBrutas: number;
  totalVentasBase: number;
  totalVentasIVA: number;
  totalVentasCount: number;

  totalComprasBrutas: number;
  totalComprasBase: number;
  totalComprasIVA: number;
  totalComprasCount: number;

  totalNotasCreditoEmitidas: number;
  totalNotasCreditoRecibidas: number;
  totalNotasCreditoCount: number;
  ncEmitidasIVA: number;
  ncRecibidasIVA: number;

  totalDocSoporte: number;
  totalDocSoporteCount: number;

  totalNomina: number;
  totalNominaCount: number;

  ivaGenerado: number;
  ivaDescontable: number;
  ivaPorPagar: number;
  retencionesTotales: number;
  retencionesFuente: number;
  retencionesIVA: number;
  retencionesICA: number;
  totalTransacciones: number;
}

export type PeriodKind = 'month' | 'quarter' | 'year' | 'range';

export interface Period {
  kind: PeriodKind;
  /** ISO (YYYY-MM-DD) inclusive */
  start: string;
  /** ISO (YYYY-MM-DD) inclusive */
  end: string;
  label: string;
}

export interface DocumentFilters {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  party?: string;
  estado?: string;
  tipo?: string;
  minTotal?: string;
  maxTotal?: string;
  hasIva?: boolean;
  onlyRejected?: boolean;
  onlyPending?: boolean;
}

export type ViewId =
  | 'inicio'
  | 'ventas'
  | 'compras'
  | 'nc'
  | 'dse'
  | 'nomina'
  | 'iva'
  | 'retenciones'
  | 'conciliacion'
  | 'obligaciones'
  | 'terceros'
  | 'reportes'
  | 'fuentes'
  | 'configuracion'
  | 'usuarios-acceso';

export interface NavTarget {
  view: ViewId;
  filters?: DocumentFilters;
}

export interface AttentionItemData {
  id: string;
  label: string;
  count: number;
  severity: 'error' | 'warning' | 'neutral';
  target: NavTarget;
}

export interface ParsedUblLine {
  id: string;
  description: string;
  quantity: number;
  unitCode: string;
  unitPrice: number;
  subtotal: number;
  taxes: Array<{
    name: string;
    percent: number;
    amount: number;
  }>;
}

export interface ParsedUblTax {
  name: string;
  code?: string;
  percent: number;
  taxableAmount: number;
  taxAmount: number;
}

export interface ParsedUblInvoice {
  id: string;
  issueDate: string;
  issueTime: string;
  cufe: string;
  currency: string;
  notes: string[];
  supplier: {
    taxId: string;
    dv?: string;
    name: string;
    commercialName?: string;
    address?: string;
    city?: string;
    department?: string;
    email?: string;
    phone?: string;
  };
  customer: {
    taxId: string;
    dv?: string;
    name: string;
    address?: string;
    city?: string;
    department?: string;
    email?: string;
    phone?: string;
  };
  lines: ParsedUblLine[];
  taxes: ParsedUblTax[];
  totals: {
    lineExtensionAmount: number;
    taxExclusiveAmount: number;
    taxInclusiveAmount: number;
    payableAmount: number;
  };
}
