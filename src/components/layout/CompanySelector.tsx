import React, { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";
import { useApp } from "../../state/app-context";

export const CompanySelector: React.FC = () => {
  const { company, companies, selectCompany, apiOnline } = useApp();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!apiOnline || !companies || companies.length <= 1) {
    return (
      <div className="text-center leading-tight">
        <div className="text-[12.5px] font-medium text-ink truncate max-w-md">
          {company.name || "Empresa sin identificar"}
        </div>
        <div className="text-[11px] text-ink-faint num">
          {company.nit ? `NIT ${company.nit}` : "—"}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-line bg-surface hover:bg-canvas text-left transition-colors group shadow-sm"
        title="Cambiar de empresa / entidad contable"
      >
        <div className="w-7 h-7 rounded-md bg-brand-50 border border-brand/20 flex items-center justify-center text-brand shrink-0">
          <Building2 className="w-4 h-4" />
        </div>
        <div className="leading-tight truncate max-w-xs sm:max-w-sm">
          <div className="text-[12.5px] font-semibold text-ink truncate group-hover:text-brand transition-colors">
            {company.name || "Seleccionar empresa"}
          </div>
          <div className="text-[11px] text-ink-faint num flex items-center gap-1.5">
            <span>{company.nit ? `NIT ${company.nit}` : "—"}</span>
            <span className="w-1 h-1 rounded-full bg-line" />
            <span className="text-[10px] text-brand font-medium">
              {companies.length} entidades
            </span>
          </div>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-ink-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-1.5 w-80 bg-surface border border-line rounded-card shadow-dropdown p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
          <div className="px-2.5 py-1.5 text-[10px] font-semibold text-ink-faint uppercase tracking-wider border-b border-line mb-1">
            Empresas registradas ({companies.length})
          </div>
          <div className="space-y-0.5 max-h-64 overflow-y-auto">
            {companies.map((c) => {
              const isSelected = c.nit === company.nit;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    selectCompany(c.id);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between p-2 rounded-md text-left transition-colors ${
                    isSelected
                      ? "bg-brand-50 text-brand border border-brand/20"
                      : "hover:bg-canvas text-ink"
                  }`}
                >
                  <div className="truncate pr-2">
                    <div className="text-[12px] font-medium truncate">
                      {c.legal_name || c.trade_name || "Sin nombre"}
                    </div>
                    <div className="text-[10px] text-ink-faint num">
                      NIT: {c.nit}
                    </div>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-brand shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
