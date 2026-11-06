import React, { useMemo, useState, useEffect } from 'react';
import { useApp } from '../state/app-context';
import { PageHeader } from '../components/ui/PageHeader';
import { DataTable } from '../components/ui/DataTable';
import { StatStrip } from '../components/ui/StatStrip';
import { filterRecords } from '../utils/radianEngine';
import { invoiceColumns } from '../utils/columns';
import { formatCurrency, formatNumber } from '../utils/formatters';
import { InvoiceViewerModal } from '../components/ui/InvoiceViewerModal';
import { api } from '../api/client';
import { CloudUpload, Loader2, CheckCircle2 } from 'lucide-react';
import type { RadianRecord } from '../types/radian';

export const Compras: React.FC = () => {
  const { periodRecords, period, filters, setFilters, kpis, selectedCompanyId, reloadDataset } = useApp();
  const [selectedRecord, setSelectedRecord] = useState<RadianRecord | null>(null);
  const [eligibleCount, setEligibleCount] = useState<number>(0);
  const [isSyncingBulk, setIsSyncingBulk] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const rows = useMemo(() => filterRecords(periodRecords, 'compras'), [periodRecords]);
  const columns = useMemo(
    () => invoiceColumns('emisor', (record) => setSelectedRecord(record)),
    []
  );

  const checkEligible = async () => {
    if (!selectedCompanyId) return;
    try {
      const res = await api.getEligibleSyncToSiigo(selectedCompanyId);
      setEligibleCount(res.count);
    } catch {
      // Ignorar si no tiene Siigo configurado
    }
  };

  useEffect(() => {
    void checkEligible();
  }, [selectedCompanyId, periodRecords]);

  const handleBulkSync = async () => {
    if (!selectedCompanyId || isSyncingBulk) return;
    setIsSyncingBulk(true);
    setSyncMessage(null);

    try {
      const res = await api.getEligibleSyncToSiigo(selectedCompanyId);
      const docs = res.documents || [];
      if (docs.length === 0) {
        setSyncMessage('No hay facturas pendientes con Perfil RUT parametrizado.');
        setIsSyncingBulk(false);
        return;
      }

      setSyncProgress({ current: 0, total: docs.length });
      let success = 0;
      let errors = 0;

      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        setSyncProgress({ current: i + 1, total: docs.length });
        try {
          await api.syncDocumentToSiigo(selectedCompanyId, doc.id);
          success++;
        } catch {
          errors++;
        }
      }

      setSyncMessage(`Sincronización completada: ${success} comprobantes creados en Siigo, ${errors} fallidos.`);
      await reloadDataset();
      await checkEligible();
    } catch (err: any) {
      setSyncMessage(err.message || 'Error en sincronización masiva');
    } finally {
      setIsSyncingBulk(false);
      setSyncProgress(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Compras"
        subtitle={`${period.label} · ${formatNumber(rows.length)} facturas recibidas`}
        actions={
          <div className="flex items-center gap-2">
            {syncProgress && (
              <span className="text-xs font-medium text-brand animate-pulse">
                Sincronizando {syncProgress.current} de {syncProgress.total}...
              </span>
            )}
            <button
              type="button"
              onClick={handleBulkSync}
              disabled={isSyncingBulk || eligibleCount === 0}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition ${
                eligibleCount > 0 && !isSyncingBulk
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-canvas text-ink-muted border border-line cursor-not-allowed opacity-70'
              }`}
            >
              {isSyncingBulk ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Procesando lote...</span>
                </>
              ) : (
                <>
                  <CloudUpload className="w-3.5 h-3.5" />
                  <span>
                    {eligibleCount > 0
                      ? `Sincronizar a Siigo (${eligibleCount} listas)`
                      : 'Sincronizar a Siigo'}
                  </span>
                </>
              )}
            </button>
          </div>
        }
      />

      {syncMessage && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{syncMessage}</span>
          </div>
          <button
            onClick={() => setSyncMessage(null)}
            className="text-xs text-ink-muted hover:text-ink underline ml-4"
          >
            Cerrar
          </button>
        </div>
      )}

      <StatStrip
        items={[
          { label: 'Total comprado', value: formatCurrency(kpis.totalComprasBrutas) },
          { label: 'Base gravable', value: formatCurrency(kpis.totalComprasBase) },
          { label: 'IVA descontable', value: formatCurrency(kpis.totalComprasIVA) },
          {
            label: 'Notas crédito recibidas',
            value: formatCurrency(kpis.totalNotasCreditoRecibidas),
            sub: `${formatNumber(periodRecords.filter((r) => (r['Tipo de documento'] || '').toLowerCase().includes('nota de cr') && (r['Grupo'] || '').toLowerCase() === 'recibido').length)} documentos`,
          },
        ]}
      />

      <DataTable
        title="Facturas electrónicas de compra"
        description="Documentos recibidos de proveedores con IVA acreditable."
        rows={rows}
        columns={columns}
        filters={filters}
        onFiltersChange={setFilters}
        partySide="emisor"
        searchPlaceholder="Buscar por folio, proveedor o NIT..."
        emptyTitle="Sin facturas de compra"
        emptyDescription="No hay facturas recibidas que coincidan con los filtros del periodo."
        onRowClick={(record) => setSelectedRecord(record)}
      />

      {selectedRecord && selectedCompanyId && (
        <InvoiceViewerModal
          document={selectedRecord}
          companyId={selectedCompanyId}
          onClose={() => setSelectedRecord(null)}
          onTaxesSaved={() => void reloadDataset()}
        />
      )}
    </>
  );
};
