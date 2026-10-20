import { ErpStatusBadge } from '../components/ui/ErpStatusBadge';
import type { ColumnDef } from '../components/ui/DataTable';
import type { RadianRecord } from '../types/radian';
import { StatusBadge } from '../components/ui/StatusBadge';
import { FileText } from 'lucide-react';
import { formatCurrency, formatDate } from './formatters';

const folio = (r: RadianRecord) => (r.Prefijo ? `${r.Prefijo}-${r.Folio}` : String(r.Folio));

const partyName = (r: RadianRecord, side: 'emisor' | 'receptor') =>
  side === 'emisor' ? r['Nombre Emisor'] : r['Nombre Receptor'];

const partyNit = (r: RadianRecord, side: 'emisor' | 'receptor') =>
  String(side === 'emisor' ? r['NIT Emisor'] : r['NIT Receptor'] || '');

export function invoiceColumns(side: 'emisor' | 'receptor', onViewXml?: (record: RadianRecord) => void): ColumnDef[] {
  const partyHeader = side === 'emisor' ? 'Proveedor' : 'Cliente';
  return [
    {
      key: 'doc',
      header: 'Factura',
      sortValue: folio,
      render: (r) => <span className="num font-medium text-ink">{folio(r)}</span>,
    },
    {
      key: 'fecha',
      header: 'Fecha',
      sortValue: (r) => String(r['Fecha Emisión'] || ''),
      render: (r) => <span className="num text-ink-muted">{formatDate(r['Fecha Emisión'])}</span>,
    },
    {
      key: 'tercero',
      header: partyHeader,
      sortValue: (r) => String(partyName(r, side) || ''),
      render: (r) => (
        <span className="block truncate max-w-[240px] text-ink" title={String(partyName(r, side) || '')}>
          {partyName(r, side) || '—'}
        </span>
      ),
    },
    {
      key: 'nit',
      header: 'NIT',
      sortValue: (r) => partyNit(r, side),
      render: (r) => <span className="num text-ink-muted">{partyNit(r, side) || '—'}</span>,
    },
    {
      key: 'base',
      header: 'Base',
      align: 'right',
      sortValue: (r) => r.baseCalculada || 0,
      render: (r) => <span className="num text-ink-muted">{formatCurrency(r.baseCalculada)}</span>,
    },
    {
      key: 'iva',
      header: 'IVA',
      align: 'right',
      sortValue: (r) => r.IVA || 0,
      render: (r) => <span className="num text-ink">{formatCurrency(r.IVA)}</span>,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      sortValue: (r) => r.Total || 0,
      render: (r) => <span className="num font-semibold text-ink">{formatCurrency(r.Total)}</span>,
    },
    {
      key: 'estado',
      header: 'Estado DIAN',
      align: 'center',
      sortValue: (r) => r.Estado || '',
      render: (r) => <StatusBadge estado={r.Estado} />,
    },
    {
      key: 'erp_estado',
      header: 'Siigo / ERP',
      align: 'center',
      sortValue: (r) => r.match_status || '',
      render: (r) => <ErpStatusBadge status={r.match_status} externalNumber={r.external_erp_number} errorMessage={r.match_error} />,
    },
    ...(onViewXml
      ? [
          {
            key: 'xml_accion',
            header: 'Factura',
            align: 'center' as const,
            render: (r: RadianRecord) => (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewXml?.(r);
                }}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-brand/10 hover:bg-brand/20 text-brand text-[11px] font-medium transition cursor-pointer border border-brand/20"
                title="Ver factura"
              >
                <FileText className="w-3 h-3" />
                Ver Factura
              </button>
            ),
          },
        ]
      : []),
  ];
}

export function creditNoteColumns(): ColumnDef[] {
  return [
    {
      key: 'numero',
      header: 'Número',
      sortValue: folio,
      render: (r) => <span className="num font-medium text-ink">{folio(r)}</span>,
    },
    {
      key: 'fecha',
      header: 'Fecha',
      sortValue: (r) => String(r['Fecha Emisión'] || ''),
      render: (r) => <span className="num text-ink-muted">{formatDate(r['Fecha Emisión'])}</span>,
    },
    {
      key: 'tercero',
      header: 'Tercero',
      sortValue: (r) => String(r['Nombre Receptor'] || ''),
      render: (r) => (
        <span className="block truncate max-w-[220px] text-ink" title={String(r['Nombre Receptor'] || '')}>
          {(r['Grupo'] || '').toLowerCase() === 'emitido'
            ? r['Nombre Receptor'] || '—'
            : r['Nombre Emisor'] || '—'}
        </span>
      ),
    },
    {
      key: 'relacionado',
      header: 'Documento relacionado',
      render: () => <span className="text-ink-faint">—</span>,
    },
    {
      key: 'valor',
      header: 'Valor',
      align: 'right',
      sortValue: (r) => r.Total || 0,
      render: (r) => <span className="num font-semibold text-ink">{formatCurrency(r.Total)}</span>,
    },
    {
      key: 'iva',
      header: 'IVA',
      align: 'right',
      sortValue: (r) => r.IVA || 0,
      render: (r) => <span className="num text-ink">{formatCurrency(r.IVA)}</span>,
    },
    {
      key: 'motivo',
      header: 'Motivo',
      render: () => <span className="text-ink-faint">—</span>,
    },
    {
      key: 'estado',
      header: 'Estado DIAN',
      align: 'center',
      sortValue: (r) => r.Estado || '',
      render: (r) => <StatusBadge estado={r.Estado} />,
    },
    {
      key: 'erp_estado',
      header: 'Siigo / ERP',
      align: 'center',
      sortValue: (r) => r.match_status || '',
      render: (r) => <ErpStatusBadge status={r.match_status} externalNumber={r.external_erp_number} errorMessage={r.match_error} />,
    },
  ];
}

export function supportDocColumns(): ColumnDef[] {
  return [
    {
      key: 'doc',
      header: 'Documento',
      sortValue: folio,
      render: (r) => <span className="num font-medium text-ink">{folio(r)}</span>,
    },
    {
      key: 'fecha',
      header: 'Fecha',
      sortValue: (r) => String(r['Fecha Emisión'] || ''),
      render: (r) => <span className="num text-ink-muted">{formatDate(r['Fecha Emisión'])}</span>,
    },
    {
      key: 'tercero',
      header: 'Tercero',
      sortValue: (r) => String(r['Nombre Receptor'] || ''),
      render: (r) => (
        <span className="block truncate max-w-[220px] text-ink" title={String(r['Nombre Receptor'] || '')}>
          {r['Nombre Receptor'] || r['Nombre Emisor'] || '—'}
        </span>
      ),
    },
    {
      key: 'nit',
      header: 'NIT',
      sortValue: (r) => String(r['NIT Receptor'] || ''),
      render: (r) => (
        <span className="num text-ink-muted">
          {String(r['NIT Receptor'] || r['NIT Emisor'] || '') || '—'}
        </span>
      ),
    },
    {
      key: 'valor',
      header: 'Valor',
      align: 'right',
      sortValue: (r) => r.Total || 0,
      render: (r) => <span className="num font-semibold text-ink">{formatCurrency(r.Total)}</span>,
    },
    {
      key: 'tipo',
      header: 'Tipo',
      sortValue: (r) => String(r['Tipo de documento'] || ''),
      render: (r) => <span className="text-ink-muted">{r['Tipo de documento']}</span>,
    },
    {
      key: 'estado',
      header: 'Estado DIAN',
      align: 'center',
      sortValue: (r) => r.Estado || '',
      render: (r) => <StatusBadge estado={r.Estado} />,
    },
    {
      key: 'erp_estado',
      header: 'Siigo / ERP',
      align: 'center',
      sortValue: (r) => r.match_status || '',
      render: (r) => <ErpStatusBadge status={r.match_status} externalNumber={r.external_erp_number} errorMessage={r.match_error} />,
    },
  ];
}

export function payrollColumns(): ColumnDef[] {
  return [
    {
      key: 'doc',
      header: 'Documento',
      sortValue: folio,
      render: (r) => <span className="num font-medium text-ink">{folio(r)}</span>,
    },
    {
      key: 'empleado',
      header: 'Empleado',
      sortValue: (r) => String(r['Nombre Receptor'] || ''),
      render: (r) => (
        <span className="block truncate max-w-[240px] text-ink" title={String(r['Nombre Receptor'] || '')}>
          {r['Nombre Receptor'] || '—'}
        </span>
      ),
    },
    {
      key: 'identificacion',
      header: 'Identificación',
      sortValue: (r) => String(r['NIT Receptor'] || ''),
      render: (r) => <span className="num text-ink-muted">{String(r['NIT Receptor'] || '—')}</span>,
    },
    {
      key: 'periodo',
      header: 'Periodo',
      sortValue: (r) => String(r['Fecha Emisión'] || ''),
      render: (r) => <span className="num text-ink-muted">{formatDate(r['Fecha Emisión'])}</span>,
    },
    {
      key: 'devengado',
      header: 'Devengado',
      align: 'right',
      sortValue: (r) => r.Total || 0,
      render: (r) => <span className="num font-semibold text-ink">{formatCurrency(r.Total)}</span>,
    },
    {
      key: 'estado',
      header: 'Estado',
      align: 'center',
      sortValue: (r) => r.Estado || '',
      render: (r) => <StatusBadge estado={r.Estado} />,
    },
  ];
}
