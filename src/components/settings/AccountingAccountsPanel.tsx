import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import { api, type AccountingAccountDto } from '../../api/client';
import { Panel } from '../ui/Panel';
import { SectionHeader } from '../ui/SectionHeader';

interface Props {
  companyId: string | null;
}

export const AccountingAccountsPanel: React.FC<Props> = ({ companyId }) => {
  const [accounts, setAccounts] = useState<AccountingAccountDto[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [filterText, setFilterText] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadAccounts = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const res = await api.getAccountingAccounts(companyId);
      setAccounts(res.accounts);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error cargando cuentas contables.' });
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const handleSyncFromSiigo = async () => {
    if (!companyId || syncing) return;
    setSyncing(true);
    setMessage(null);
    try {
      const res = await api.syncAccountingAccountsFromSiigo(companyId);
      setMessage({
        type: 'success',
        text: `Sincronización exitosa: ${res.total_synced} cuentas auxiliares procesadas (${res.inserted} creadas, ${res.updated} actualizadas).`,
      });
      await loadAccounts();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error al sincronizar con Siigo.' });
    } finally {
      setSyncing(false);
    }
  };

  const handleToggle = async (account: AccountingAccountDto) => {
    const nextState = !account.is_active;
    setAccounts((prev) => prev.map((a) => (a.id === account.id ? { ...a, is_active: nextState } : a)));
    try {
      await api.toggleAccountingAccount(companyId, account.id, nextState);
    } catch {
      // Revertir
      setAccounts((prev) => prev.map((a) => (a.id === account.id ? { ...a, is_active: !nextState } : a)));
    }
  };

  const filteredAccounts = accounts.filter((a) => {
    const matchesText =
      a.code.toLowerCase().includes(filterText.toLowerCase()) ||
      a.name.toLowerCase().includes(filterText.toLowerCase());

    if (!matchesText) return false;
    if (categoryFilter === 'EXPENSE') return a.code.startsWith('5') || a.code.startsWith('6') || a.code.startsWith('7');
    if (categoryFilter === 'LIABILITY') return a.code.startsWith('2');
    if (categoryFilter === 'ASSET') return a.code.startsWith('1');
    if (categoryFilter === 'REVENUE') return a.code.startsWith('4');
    return true;
  });

  const handleToggleAll = async (is_active: boolean) => {
    if (!companyId) return;
    const targetIds = new Set(filteredAccounts.map((a) => a.id));
    setAccounts((prev) =>
      prev.map((a) => (targetIds.has(a.id) ? { ...a, is_active } : a))
    );
    try {
      await api.toggleAllAccountingAccounts(companyId, is_active, categoryFilter);
    } catch {
      await loadAccounts();
    }
  };

  const allFilteredActive = filteredAccounts.length > 0 && filteredAccounts.every((a) => a.is_active);
  const someFilteredActive = filteredAccounts.some((a) => a.is_active);

  const activeCount = accounts.filter((a) => a.is_active).length;

  return (
    <Panel className="p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-line">
        <SectionHeader
          title="Plan Único de Cuentas (PUC Siigo)"
          description="Controla qué cuentas auxiliares transaccionales de Siigo están disponibles en los selectores del sistema"
        />
        <button
          type="button"
          onClick={handleSyncFromSiigo}
          disabled={syncing || !companyId}
          className="h-8 px-3 inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-brand text-white hover:bg-brand-dark transition-colors disabled:opacity-50 shrink-0"
        >
          {syncing ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Sincronizando desde Siigo...</span>
            </>
          ) : (
            <>
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Sincronizar Cuentas desde Siigo</span>
            </>
          )}
        </button>
      </div>

      {message && (
        <div
          className={`mt-4 p-3 rounded-lg text-xs font-medium ${
            message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Barra de filtros y métricas */}
      <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Buscar por código o nombre..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-line bg-canvas text-ink focus:outline-none focus:border-brand"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-8 px-2.5 text-xs rounded-md border border-line bg-canvas text-ink focus:outline-none focus:border-brand"
          >
            <option value="ALL">Todas las clases</option>
            <option value="EXPENSE">Gastos y Costos (5, 6, 7)</option>
            <option value="LIABILITY">Pasivos / CxP (2)</option>
            <option value="ASSET">Activos (1)</option>
            <option value="REVENUE">Ingresos (4)</option>
          </select>

          <span className="text-xs text-ink-muted whitespace-nowrap">
            {activeCount} de {accounts.length} activas
          </span>
        </div>
      </div>

      {/* Tabla de cuentas */}
      <div className="mt-4 border border-line rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-ink-muted flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-brand" />
            <span>Cargando cuentas contables...</span>
          </div>
        ) : filteredAccounts.length === 0 ? (
          <div className="p-8 text-center text-xs text-ink-muted">
            No se encontraron cuentas con los filtros seleccionados.
          </div>
        ) : (
          <div className="max-h-[480px] overflow-y-auto divide-y divide-line">
            <div className="grid grid-cols-12 gap-3 px-4 py-2 bg-canvas/60 text-[11px] font-semibold text-ink-muted sticky top-0 z-10 border-b border-line items-center">
              <span className="col-span-2">Código</span>
              <span className="col-span-7">Nombre Cuenta Contable</span>
              <span className="col-span-2">Nivel</span>
              <div className="col-span-1 flex items-center justify-end gap-1.5">
                <span className="text-[10px]">Todos</span>
                <input
                  type="checkbox"
                  checked={allFilteredActive}
                  ref={(el) => {
                    if (el) el.indeterminate = !allFilteredActive && someFilteredActive;
                  }}
                  onChange={(e) => handleToggleAll(e.target.checked)}
                  className="w-4 h-4 accent-brand rounded cursor-pointer"
                  title={allFilteredActive ? 'Desmarcar todas' : 'Marcar todas'}
                />
              </div>
            </div>

            {filteredAccounts.map((account) => (
              <div
                key={account.id}
                className={`grid grid-cols-12 gap-3 px-4 py-2.5 items-center text-xs transition-colors hover:bg-canvas/30 ${
                  !account.is_active ? 'opacity-50 bg-canvas/10' : ''
                }`}
              >
                <span className="col-span-2 font-mono font-medium text-ink">{account.code}</span>
                <span className="col-span-7 text-ink truncate" title={account.name}>
                  {account.name}
                </span>
                <span className="col-span-2 text-[11px] text-ink-muted">{account.level}</span>
                <div className="col-span-1 flex justify-end">
                  <input
                    type="checkbox"
                    checked={account.is_active}
                    onChange={() => handleToggle(account)}
                    className="w-4 h-4 accent-brand rounded cursor-pointer"
                    title={account.is_active ? 'Visible en dropdowns' : 'Oculto en dropdowns'}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
};
