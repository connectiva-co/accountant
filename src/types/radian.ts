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

  totalDocSoporte: number;
  totalDocSoporteCount: number;

  totalNomina: number;
  totalNominaCount: number;

  ivaPorPagar: number; // IVA Ventas - IVA Compras Descontable
  retencionesTotales: number;
  totalTransacciones: number;
}
