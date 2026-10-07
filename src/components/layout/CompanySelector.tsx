import React, { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";
import { useApp } from "../../state/app-context";

export const CompanySelector: React.FC = () => {
  const { company, companies, selectCompany } = useApp();
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

  const initials = (company.name || "E")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2.5 px-2 py-1 rounded-md hover:bg-canvas text-left transition-colors group"
        title="Cambiar de empresa / entidad contable"
      >
        <div className="w-7 h-7 rounded-md bg-brand-50 border border-brand/20 flex items-center justify-center text-brand font-semibold text-[11px] shrink-0">
          {initials || <Building2 className="w-3.5 h-3.5" />}
        </div>
        <div className="leading-tight">
          <div className="text-[12.5px] font-semibold text-ink flex items-center gap-1">
            <span className="truncate max-w-[180px] sm:max-w-[240px] md:max-w-[320px]">
              {company.name || "Seleccionar empresa"}
            </span>
            {companies && companies.length > 1 && (
              <ChevronDown className={`w-3.5 h-3.5 text-ink-faint transition-transform duration-150 group-hover:text-ink shrink-0 ${open ? "rotate-180" : ""}`} />
            )}
          </div>
          <div className="text-[11px] text-ink-faint num flex items-center gap-1.5">
            <span>{company.nit ? `NIT ${company.nit}` : "—"}</span>
            {companies && companies.length > 1 && (
              <>
                <span className="w-1 h-1 rounded-full bg-line" />
                <span className="text-[10px] text-brand font-medium">
                  {companies.length} empresas
                </span>
              </>
            )}
          </div>
        </div>
      </button>

      {open && companies && companies.length > 1 && (
        <div className="absolute top-full left-0 mt-1.5 w-80 bg-surface border border-line rounded-card shadow-dropdown p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
          <div className="px-2.5 py-1.5 text-[10px] font-semibold text-ink-faint uppercase tracking-wider border-b border-line mb-1 flex items-center justify-between">
            <span>Empresas disponibles</span>
            <span className="num text-[10px] text-brand">{companies.length}</span>
          </div>
          <div className="space-y-0.5 max-h-64 overflow-y-auto">
            {companies.map((c) => {
              const isSelected = c.nit === company.nit;
              const itemInitials = (c.legal_name || c.trade_name || "E")
                .split(" ")
                .filter(Boolean)
                .slice(0, 2)
                .map((w) => w[0])
                .join("")
                .toUpperCase();
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
                      ? "bg-brand-50 text-brand border border-brand/20 font-medium"
                      : "hover:bg-canvas text-ink"
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate pr-2">
                    <div className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-semibold shrink-0 ${
                      isSelected ? "bg-brand text-white" : "bg-canvas text-ink-muted border border-line"
                    }`}>
                      {itemInitials}
                    </div>
                    <div className="truncate">
                      <div className="text-[12px] truncate font-medium">
                        {c.legal_name || c.trade_name || "Sin nombre"}
                      </div>
                      <div className="text-[10.5px] text-ink-faint num">
                        NIT: {c.nit}
                      </div>
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
