import React, { useMemo, useState, useEffect } from 'react';
import { useApp } from '../state/app-context';
import { PageHeader } from '../components/ui/PageHeader';
import { DataTable } from '../components/ui/DataTable';
import { StatStrip } from '../components/ui/StatStrip';
import { filterRecords } from '../utils/radianEngine';
import { invoiceColumns } from '../utils/columns';
import { formatCurrency, formatNumber } from '../utils/formatters';
import { InvoiceViewerModal } from '../components/ui/InvoiceViewerModal';
import { SimulationResultsModal } from '../components/ui/SimulationResultsModal';
import { api } from '../api/client';
import { CloudUpload, Play, Loader2, CheckCircle2 } from 'lucide-react';
import type { RadianRecord } from '../types/radian';
import type { AccountingSimulationDocument } from '../utils/simulationExcel';

export const Compras: React.FC = () => {
  const { periodRecords, period, filters, setFilters, kpis, selectedCompanyId, reloadDataset } = useApp();
  const [selectedRecord, setSelectedRecord] = useState<RadianRecord | null>(null);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [eligibleCount, setEligibleCount] = useState<number>(0);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [isSyncingBulk, setIsSyncingBulk] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [simulationData, setSimulationData] = useState<{
    summary: {
      total_documents: number;
      valid: number;
      errors: number;
      total_debits: number;
      total_credits: number;
      is_balanced: boolean;
    };
    documents: AccountingSimulationDocument[];
  } | null>(null);
  const [showSimModal, setShowSimModal] = useState<boolean>(false);

  const rows = useMemo(() => filterRecords(periodRecords, 'compras'), [periodRecords]);

  // Manejo de Selección de Facturas
  const toggleSelectAll = () => {
    if (selectedDocIds.size === rows.length) {
      setSelectedDocIds(new Set());
    } else {
      const allIds = new Set<string>();
      rows.forEach((r) => {
        if (r.id) allIds.add(r.id);
      });
      setSelectedDocIds(allIds);
    }
  };

  const toggleSelectOne = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const baseColumns = useMemo(
    () => invoiceColumns('emisor', (record) => setSelectedRecord(record)),
    []
  );

  const columns = useMemo(() => {
    const isAllSelected = rows.length > 0 && selectedDocIds.size === rows.length;
    return [
      {
        key: 'select',
        header: (
          <input
            type="checkbox"
            checked={isAllSelected}
            onChange={toggleSelectAll}
            className="h-3.5 w-3.5 rounded border-line text-brand focus:ring-brand/30"
            title="Seleccionar todas las facturas"
          />
        ),
        width: '40px',
        render: (r: RadianRecord) => {
          const docId = r.id;
          const isSelected = docId ? selectedDocIds.has(docId) : false;
          return (
            <input
              type="checkbox"
              checked={isSelected}
              disabled={!docId}
              onChange={(e) => toggleSelectOne(docId!, e as any)}
              onClick={(e) => e.stopPropagation()}
              className="h-3.5 w-3.5 rounded border-line text-brand focus:ring-brand/30"
            />
          );
        },
      },
      ...baseColumns,
    ];
  }, [baseColumns, rows, selectedDocIds]);

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

  // Ejecutar Simulación Masiva (Dry Run)
  const handleSimulate = async () => {
    if (!selectedCompanyId || isSimulating) return;
    setIsSimulating(true);
    setSyncMessage(null);

    try {
      const docIdsArray = selectedDocIds.size > 0 ? Array.from(selectedDocIds) : undefined;
      const res = await api.simulateSyncToSiigo(selectedCompanyId, docIdsArray);
      setSimulationData(res);
      setShowSimModal(true);
    } catch (err: any) {
      setSyncMessage(err.message || 'Error ejecutando simulación contable');
    } finally {
      setIsSimulating(false);
    }
  };

  // Ejecutar Envío Masivo a Siigo
  const handleBulkSync = async (targetDocs?: AccountingSimulationDocument[]) => {
    if (!selectedCompanyId || isSyncingBulk) return;
    setIsSyncingBulk(true);
    setSyncMessage(null);

    try {
      let docsToSync: Array<{ id: string }> = [];

      if (targetDocs && targetDocs.length > 0) {
        docsToSync = targetDocs.map((d) => ({ id: d.document_id }));
      } else if (selectedDocIds.size > 0) {
        docsToSync = Array.from(selectedDocIds).map((id) => ({ id }));
      } else {
        const res = await api.getEligibleSyncToSiigo(selectedCompanyId);
        docsToSync = res.documents || [];
      }

      if (docsToSync.length === 0) {
        setSyncMessage('No hay facturas seleccionadas ni pendientes con Perfil RUT parametrizado.');
        setIsSyncingBulk(false);
        return;
      }

      setShowSimModal(false);
      setSyncProgress({ current: 0, total: docsToSync.length });
      let success = 0;
      let errors = 0;

      for (let i = 0; i < docsToSync.length; i++) {
        const doc = docsToSync[i];
        setSyncProgress({ current: i + 1, total: docsToSync.length });
        try {
          await api.syncDocumentToSiigo(selectedCompanyId, doc.id);
          success++;
        } catch {
          errors++;
        }
      }

      setSyncMessage(`Sincronización completada: ${success} comprobantes creados en Siigo, ${errors} fallidos.`);
      setSelectedDocIds(new Set());
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

            {/* Botón Simular Causación (Dry Run) */}
            <button
              type="button"
              onClick={handleSimulate}
              disabled={isSimulating || isSyncingBulk || rows.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-line bg-surface hover:bg-canvas text-ink transition shadow-sm disabled:opacity-50"
            >
              {isSimulating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-brand" />
                  <span>Simulando...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 text-brand" />
                  <span>
                    Simular causación{' '}
                    {selectedDocIds.size > 0 ? `(${selectedDocIds.size})` : '(Todas)'}
                  </span>
                </>
              )}
            </button>

            {/* Botón Sincronizar Masivo a Siigo */}
            <button
              type="button"
              onClick={() => void handleBulkSync()}
              disabled={isSyncingBulk || isSimulating || (eligibleCount === 0 && selectedDocIds.size === 0)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition ${
                (eligibleCount > 0 || selectedDocIds.size > 0) && !isSyncingBulk
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
                    {selectedDocIds.size > 0
                      ? `Sincronizar a Siigo (${selectedDocIds.size} selec.)`
                      : eligibleCount > 0
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

      {/* Modal de Detalle de Factura */}
      {selectedRecord && selectedCompanyId && (
        <InvoiceViewerModal
          document={selectedRecord}
          companyId={selectedCompanyId}
          onClose={() => setSelectedRecord(null)}
          onTaxesSaved={() => void reloadDataset()}
        />
      )}

      {/* Modal de Simulación Contable y Descarga Excel */}
      <SimulationResultsModal
        isOpen={showSimModal}
        simulationData={simulationData}
        isSyncing={isSyncingBulk}
        onClose={() => setShowSimModal(false)}
        onConfirmSync={(validDocs) => void handleBulkSync(validDocs)}
      />
    </>
  );
};
