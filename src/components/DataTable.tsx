import React, { useState, useMemo } from 'react';
import { Search, ChevronLeft, ChevronRight, FileText, ArrowUpDown } from 'lucide-react';
import { formatCurrency } from '../utils/formatters';
import type { RadianRecord } from '../types/radian';

interface DataTableProps {
  records: RadianRecord[];
  title: string;
  subtitle: string;
}

export const DataTable: React.FC<DataTableProps> = ({ records, title, subtitle }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<keyof RadianRecord>('Fecha Emisión');
  const [sortAsc, setSortAsc] = useState(false);
  const itemsPerPage = 12;

  const filteredRecords = useMemo(() => {
    let result = records;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter(
        (r) =>
          String(r.Folio).toLowerCase().includes(q) ||
          (r['Nombre Emisor'] && r['Nombre Emisor'].toLowerCase().includes(q)) ||
          (r['Nombre Receptor'] && r['Nombre Receptor'].toLowerCase().includes(q)) ||
          String(r['NIT Emisor']).includes(q) ||
          String(r['NIT Receptor']).includes(q) ||
          (r['Tipo de documento'] && r['Tipo de documento'].toLowerCase().includes(q))
      );
    }

    result.sort((a, b) => {
      const valA = a[sortField] ?? '';
      const valB = b[sortField] ?? '';
      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortAsc ? valA - valB : valB - valA;
      }
      return sortAsc
        ? String(valA).localeCompare(String(valB))
        : String(valB).localeCompare(String(valA));
    });

    return result;
  }, [records, searchTerm, sortField, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / itemsPerPage));
  const paginatedRecords = filteredRecords.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSort = (field: keyof RadianRecord) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <FileText className="w-4 h-4 text-brand-400" />
            {title}
            <span className="text-xs font-normal text-slate-400 font-mono bg-slate-800 px-2 py-0.5 rounded-full">
              {filteredRecords.length} registros
            </span>
          </h3>
          <p className="text-xs text-slate-400">{subtitle}</p>
        </div>

        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por folio, NIT, emisor o receptor..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-9 pr-4 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-brand-500 w-64 sm:w-80 transition-colors"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800/80">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900/90 text-slate-400 uppercase tracking-wider text-[10px] font-semibold border-b border-slate-800">
            <tr>
              <th className="p-3 cursor-pointer hover:text-white" onClick={() => handleSort('Tipo de documento')}>
                <div className="flex items-center space-x-1"><span>Tipo</span><ArrowUpDown className="w-3 h-3" /></div>
              </th>
              <th className="p-3 cursor-pointer hover:text-white" onClick={() => handleSort('Folio')}>
                <div className="flex items-center space-x-1"><span>Folio</span><ArrowUpDown className="w-3 h-3" /></div>
              </th>
              <th className="p-3 cursor-pointer hover:text-white" onClick={() => handleSort('Fecha Emisión')}>
                <div className="flex items-center space-x-1"><span>Emisión</span><ArrowUpDown className="w-3 h-3" /></div>
              </th>
              <th className="p-3">Emisor (NIT / Nombre)</th>
              <th className="p-3">Receptor (NIT / Nombre)</th>
              <th className="p-3 text-right cursor-pointer hover:text-white" onClick={() => handleSort('baseCalculada')}>
                <div className="flex items-center justify-end space-x-1"><span>Base Gravable</span><ArrowUpDown className="w-3 h-3" /></div>
              </th>
              <th className="p-3 text-right cursor-pointer hover:text-white" onClick={() => handleSort('IVA')}>
                <div className="flex items-center justify-end space-x-1"><span>IVA</span><ArrowUpDown className="w-3 h-3" /></div>
              </th>
              <th className="p-3 text-right cursor-pointer hover:text-white" onClick={() => handleSort('Total')}>
                <div className="flex items-center justify-end space-x-1"><span>Total</span><ArrowUpDown className="w-3 h-3" /></div>
              </th>
              <th className="p-3 text-center">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50 text-slate-300">
            {paginatedRecords.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-slate-500 text-xs">
                  No se encontraron documentos que coincidan con la búsqueda.
                </td>
              </tr>
            ) : (
              paginatedRecords.map((r, i) => (
                <tr key={i} className="hover:bg-slate-800/40 transition-colors font-mono">
                  <td className="p-3 font-sans text-slate-200 font-medium whitespace-nowrap">
                    {r['Tipo de documento']}
                  </td>
                  <td className="p-3 text-brand-400 font-semibold">
                    {r.Prefijo ? `${r.Prefijo}-${r.Folio}` : r.Folio}
                  </td>
                  <td className="p-3 text-slate-400 whitespace-nowrap">
                    {String(r['Fecha Emisión']).substring(0, 10)}
                  </td>
                  <td className="p-3 font-sans max-w-[180px] truncate" title={r['Nombre Emisor']}>
                    <div className="text-slate-200 truncate">{r['Nombre Emisor']}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{r['NIT Emisor']}</div>
                  </td>
                  <td className="p-3 font-sans max-w-[180px] truncate" title={r['Nombre Receptor']}>
                    <div className="text-slate-200 truncate">{r['Nombre Receptor']}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{r['NIT Receptor']}</div>
                  </td>
                  <td className="p-3 text-right text-slate-300">
                    {formatCurrency(r.baseCalculada)}
                  </td>
                  <td className="p-3 text-right text-amber-400/90">
                    {formatCurrency(r.IVA)}
                  </td>
                  <td className="p-3 text-right font-bold text-white">
                    {formatCurrency(r.Total)}
                  </td>
                  <td className="p-3 text-center font-sans">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 whitespace-nowrap">
                      {r.Estado || 'Aprobado'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-4 text-xs text-slate-400">
        <div>
          Página <span className="font-bold text-white">{currentPage}</span> de <span className="font-bold text-white">{totalPages}</span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="p-1.5 rounded-lg bg-slate-900 border border-slate-700 disabled:opacity-30 hover:bg-slate-800 text-slate-200 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="p-1.5 rounded-lg bg-slate-900 border border-slate-700 disabled:opacity-30 hover:bg-slate-800 text-slate-200 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
