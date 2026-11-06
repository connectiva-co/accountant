import React, { useCallback, useEffect, useState } from 'react';
import { Check, CheckSquare, Loader2, RefreshCw, Search, Square } from 'lucide-react';
import { api, type SiigoDocumentTypeDto } from '../../api/client';
import { Panel } from '../ui/Panel';
import { SectionHeader } from '../ui/SectionHeader';

interface Props {
  companyId: string | null;
}

export const SiigoDocumentTypesPanel: React.FC<Props> = ({ companyId }) => {
  const [docTypes, setDocTypes] = useState<SiigoDocumentTypeDto[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [filterText, setFilterText] = useState<string>('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadDocTypes = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const res = await api.getSiigoDocumentTypes(companyId, { type: 'CC' });
      setDocTypes(res.document_types as any[]);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error cargando tipos de comprobante.' });
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadDocTypes();
  }, [loadDocTypes]);

  const handleSync = async () => {
    if (!companyId || syncing) return;
    setSyncing(true);
    setMessage(null);
    try {
      const res = await api.syncSiigoDocumentTypes(companyId, 'CC');
      setMessage({
        type: 'success',
        text: `Sincronización exitosa: ${res.total} tipos encontrados (${res.inserted} nuevos, ${res.updated} actualizados).`,
      });
      await loadDocTypes();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error al sincronizar con Siigo.' });
    } finally {
      setSyncing(false);
    }
  };

  const handleToggle = async (dt: SiigoDocumentTypeDto) => {
    const nextState = !dt.is_active;
    setDocTypes((prev) => prev.map((item) => (item.id === dt.id ? { ...item, is_active: nextState } : item)));
    try {
      await api.toggleSiigoDocumentType(companyId, dt.id, nextState);
    } catch {
      setDocTypes((prev) => prev.map((item) => (item.id === dt.id ? { ...item, is_active: dt.is_active } : item)));
    }
  };

  const filteredDocTypes = docTypes.filter((dt) => {
    if (!filterText) return true;
    const term = filterText.toLowerCase();
    return (
      dt.code.toLowerCase().includes(term) ||
      dt.name.toLowerCase().includes(term) ||
      (dt.description && dt.description.toLowerCase().includes(term))
    );
  });

  const allFilteredActive =
    filteredDocTypes.length > 0 && filteredDocTypes.every((dt) => dt.is_active);

  const handleToggleAll = async () => {
    if (!companyId || filteredDocTypes.length === 0) return;
    const targetState = !allFilteredActive;
    const affectedIds = new Set(filteredDocTypes.map((dt) => dt.id));

    setDocTypes((prev) =>
      prev.map((dt) => (affectedIds.has(dt.id) ? { ...dt, is_active: targetState } : dt))
    );

    try {
      await api.toggleAllSiigoDocumentTypes(companyId, targetState, 'CC');
    } catch (err: any) {
      await loadDocTypes();
      setMessage({ type: 'error', text: err.message || 'Error al actualizar masivamente.' });
    }
  };

  const activeCount = docTypes.filter((dt) => dt.is_active).length;

  return (
    <div className="space-y-4 max-w-5xl">
      <Panel className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <SectionHeader
            title="Tipos de Comprobante (Siigo CC)"
            description="Controla cuáles tipos de comprobante contable están visibles en los selectores del sistema"
          />
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing || !companyId}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand text-white rounded-lg text-xs font-semibold hover:bg-brand/90 transition disabled:opacity-50 shrink-0 self-start sm:self-auto cursor-pointer"
          >
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span>Sincronizar Tipos desde Siigo</span>
          </button>
        </div>

        {message && (
          <div
            className={`mt-4 p-3 rounded-lg text-xs border ${
              message.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Barra de filtros */}
        <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Buscar por código o nombre..."
              className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-line bg-surface text-xs text-ink focus:outline-none focus:border-brand"
            />
          </div>

          <div className="text-xs text-ink-muted flex items-center justify-between sm:justify-end gap-3">
            <span>
              <strong className="text-ink">{activeCount}</strong> de {docTypes.length} activos
            </span>
          </div>
        </div>

        {/* Tabla */}
        <div className="mt-4 border border-line rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-surface border-b border-line text-ink-muted font-medium">
                  <th className="py-2.5 px-3 w-28">Código</th>
                  <th className="py-2.5 px-3">Nombre</th>
                  <th className="py-2.5 px-3">Descripción</th>
                  <th className="py-2.5 px-3 w-28 text-center">
                    <button
                      type="button"
                      onClick={handleToggleAll}
                      className="inline-flex items-center gap-1.5 font-semibold text-xs text-brand hover:underline cursor-pointer"
                      title={allFilteredActive ? 'Desmarcar todos' : 'Marcar todos'}
                    >
                      {allFilteredActive ? (
                        <CheckSquare className="w-3.5 h-3.5 text-brand" />
                      ) : (
                        <Square className="w-3.5 h-3.5 text-ink-muted" />
                      )}
                      <span>Visible</span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-ink-muted">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-brand" />
                        <span>Cargando tipos de comprobante...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredDocTypes.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-ink-muted">
                      No se encontraron tipos de comprobante.
                    </td>
                  </tr>
                ) : (
                  filteredDocTypes.map((dt) => (
                    <tr
                      key={dt.id}
                      className={`hover:bg-canvas/50 transition-colors ${
                        dt.is_active ? 'bg-surface/30' : 'opacity-60'
                      }`}
                    >
                      <td className="py-2 px-3 font-mono font-medium text-ink">
                        CC-{dt.code}
                      </td>
                      <td className="py-2 px-3 text-ink font-medium">{dt.name}</td>
                      <td className="py-2 px-3 text-ink-muted">{dt.description || '-'}</td>
                      <td className="py-2 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleToggle(dt)}
                          className={`w-5 h-5 rounded border inline-flex items-center justify-center transition-colors cursor-pointer ${
                            dt.is_active
                              ? 'bg-brand border-brand text-white'
                              : 'border-line bg-surface hover:border-ink-muted'
                          }`}
                        >
                          {dt.is_active && <Check className="w-3 h-3 stroke-[3]" />}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>
    </div>
  );
};

