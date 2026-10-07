import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import sampleDataRaw from '../data/sampleRadian.json';
import { enrichRecords, computeKPIs } from '../utils/radianEngine';
import {
  filterByPeriod,
  parseRecordDate,
  previousPeriod,
  referenceDate,
  resolvePeriod,
} from '../utils/period';
import { deriveCompany } from '../utils/derivations';
import { api, ApiError, type ApiCompany, type DatasetResponse } from '../api/client';
import type { CompanyInfo } from '../config/company';
import type {
  DocumentFilters,
  FinancialKPIs,
  NavTarget,
  Period,
  PeriodKind,
  RadianRecord,
  ViewId,
} from '../types/radian';

interface PeriodState {
  kind: PeriodKind;
  range?: { from: string; to: string };
  monthOffset?: number;
}

interface AppContextValue {
  records: RadianRecord[];
  fileName: string;
  anchor: Date;
  period: Period;
  prevPeriod: Period;
  compare: boolean;
  setCompare: (v: boolean) => void;
  periodSelection: PeriodState;
  setPeriodSelection: (next: PeriodState) => void;
  periodRecords: RadianRecord[];
  prevRecords: RadianRecord[];
  kpis: FinancialKPIs;
  prevKpis: FinancialKPIs;
  view: ViewId;
  filters: DocumentFilters;
  nav: (target: NavTarget) => void;
  setFilters: (next: DocumentFilters) => void;
  company: CompanyInfo;
  setCompany: (info: CompanyInfo) => void;
  isUploadOpen: boolean;
  openUpload: () => void;
  closeUpload: () => void;
  loadRecords: (records: RadianRecord[], fileName: string) => void;
  resetDemo: () => void;
  lastUpdate: string | null;
  /** 'servidor': datos leídos de la base; 'demo': datos locales en memoria. */
  dataSource: 'servidor' | 'demo';
  /** null mientras no se haya comprobado el servidor. */
  apiOnline: boolean | null;
  /** Empresa registrada en la base de datos (null si no hay servidor/datos). */
  apiCompany: ApiCompany | null;
  /** Lista de empresas registradas en el servidor. */
  companies: ApiCompany[];
  /** Selecciona una empresa específica por su ID. */
  selectCompany: (companyId: string) => Promise<void>;
  /** Vuelve a leer /api/dataset. Devuelve false si no hay datos en el servidor. */
  reloadDataset: (companyId?: string) => Promise<boolean>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp debe usarse dentro de AppProvider');
  return ctx;
}

interface PeriodState {
  kind: PeriodKind;
  range?: { from: string; to: string };
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Estado inicial vacío: si la base está recién creada, la app arranca vacía
  // y lista para la primera importación. Los datos demo solo entran como
  // respaldo cuando el servidor no responde.
  const [records, setRecords] = useState<RadianRecord[]>([]);
  const [fileName, setFileName] = useState('');
  const [periodSelection, setPeriodSelection] = useState<PeriodState>({ kind: 'month', monthOffset: 0 });
  const [compare, setCompare] = useState(true);
  const [view, setView] = useState<ViewId>('inicio');
  const [filters, setFilters] = useState<DocumentFilters>({});
  const [company, setCompany] = useState<CompanyInfo>(() => deriveCompany(records));
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [dataSource, setDataSource] = useState<'servidor' | 'demo'>('demo');
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [apiCompany, setApiCompany] = useState<ApiCompany | null>(null);
  const [companies, setCompanies] = useState<ApiCompany[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  useEffect(() => {
    setCompany(deriveCompany(records));
  }, [records]);

  const applyDataset = useCallback((dataset: DatasetResponse, sourceName: string) => {
    setRecords(enrichRecords(dataset.records));
    setFileName(sourceName);
    setApiCompany(dataset.company);
    setDataSource('servidor');
    setApiOnline(true);
    setPeriodSelection({ kind: 'month', monthOffset: 0 });
  }, []);

  /**
   * Lee el dataset desde la API. Si el servidor no responde o no hay datos,
   * se conservan los registros actuales (demo) y la app sigue funcionando.
   */
  const reloadDataset = useCallback(async (targetCompanyId?: string): Promise<boolean> => {
    try {
      const targetId = targetCompanyId || selectedCompanyId || undefined;
      const [dataset, imports, companiesRes] = await Promise.all([
        api.getDataset(targetId),
        api.getImports(),
        api.getCompanies().catch(() => ({ companies: [] })),
      ]);
      setCompanies(companiesRes.companies || []);
      if (!dataset.records.length) {
        setApiOnline(true);
        return false;
      }
      const latest = imports.imports.find(i => !targetId || i.company_nit === dataset.company.nit) || imports.imports[0];
      applyDataset(dataset, latest ? `${latest.filename} (base de datos)` : 'Accountant (base de datos)');
      return true;
    } catch (error) {
      const online = error instanceof ApiError && error.status !== 0;
      setApiOnline(online);
      if (online) {
        // API viva pero sin empresas importadas todavía: queda vacía,
        // esperando el primer .xlsx del usuario.
        setRecords([]);
        setFileName('');
        setDataSource('servidor');
        return false;
      }
      // Servidor caído: la app se sostiene con los datos demo locales.
      setRecords(enrichRecords(sampleDataRaw));
      setFileName('RADIAN AGOSTO JGV.xlsx (datos demostrativos)');
      setDataSource('demo');
      setPeriodSelection({ kind: 'month', monthOffset: 0 });
      return false;
    }
  }, [applyDataset]);

  useEffect(() => {
    void reloadDataset();
  }, [reloadDataset]);

  const selectCompany = useCallback(async (companyId: string) => {
    setSelectedCompanyId(companyId);
    await reloadDataset(companyId);
  }, [reloadDataset]);

  const anchor = useMemo(() => {
    const base = referenceDate(records);
    const offset = periodSelection.monthOffset || 0;
    if (!offset) return base;
    return new Date(base.getFullYear(), base.getMonth() + offset, 1);
  }, [records, periodSelection.monthOffset]);

  const period = useMemo(
    () => resolvePeriod(periodSelection.kind, anchor, periodSelection.range),
    [periodSelection, anchor]
  );

  const prevPeriod = useMemo(() => previousPeriod(period), [period]);

  const periodRecords = useMemo(() => filterByPeriod(records, period), [records, period]);
  const prevRecords = useMemo(() => filterByPeriod(records, prevPeriod), [records, prevPeriod]);

  const kpis = useMemo(() => computeKPIs(periodRecords), [periodRecords]);
  const prevKpis = useMemo(() => computeKPIs(prevRecords), [prevRecords]);

  const nav = useCallback((target: NavTarget) => {
    setView(target.view);
    setFilters(target.filters || {});
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const loadRecords = useCallback((newRecords: RadianRecord[], newFileName: string) => {
    setRecords(newRecords);
    setFileName(newFileName);
    setDataSource('demo');
    setPeriodSelection({ kind: 'month', monthOffset: 0 });
  }, []);

  const resetDemo = useCallback(() => {
    setRecords(enrichRecords(sampleDataRaw));
    setFileName('RADIAN AGOSTO JGV.xlsx (datos demostrativos)');
    setDataSource('demo');
    setPeriodSelection({ kind: 'month', monthOffset: 0 });
  }, []);

  const lastUpdate = useMemo(() => {
    let max: Date | null = null;
    for (const r of records) {
      const d = parseRecordDate(r['Fecha Recepción']) || parseRecordDate(r['Fecha Emisión']);
      if (d && (!max || d > max)) max = d;
    }
    if (!max) return null;
    const dd = String(max.getDate()).padStart(2, '0');
    const mm = String(max.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${max.getFullYear()}`;
  }, [records]);

  const value = useMemo<AppContextValue>(
    () => ({
      records,
      fileName,
      anchor,
      period,
      prevPeriod,
      compare,
      setCompare,
      periodSelection,
      setPeriodSelection,
      periodRecords,
      prevRecords,
      kpis,
      prevKpis,
      view,
      filters,
      nav,
      setFilters,
      company,
      setCompany,
      isUploadOpen,
      openUpload: () => setIsUploadOpen(true),
      closeUpload: () => setIsUploadOpen(false),
      loadRecords,
      resetDemo,
      lastUpdate,
      dataSource,
      apiOnline,
      apiCompany,
      companies,
      selectCompany,
      reloadDataset,
    }),
    [
      records,
      fileName,
      anchor,
      period,
      prevPeriod,
      compare,
      periodSelection,
      periodRecords,
      prevRecords,
      kpis,
      prevKpis,
      view,
      filters,
      nav,
      company,
      isUploadOpen,
      loadRecords,
      resetDemo,
      lastUpdate,
      dataSource,
      apiOnline,
      apiCompany,
      companies,
      selectCompany,
      reloadDataset,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
