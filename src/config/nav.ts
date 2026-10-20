import {
  Home,
  ReceiptText,
  ShoppingCart,
  RotateCcw,
  FileCheck2,
  Users,
  Landmark,
  Percent,
  Scale,
  CalendarClock,
  Building2,
  FileText,
  Database,
  Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ViewId } from '../types/radian';

export interface NavItem {
  id: ViewId;
  label: string;
  icon: LucideIcon;
  /** Permiso (o cualquiera de) exigido en la empresa activa para ver la vista. */
  permission?: string | string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Resumen',
    items: [{ id: 'inicio', label: 'Inicio', icon: Home }],
  },
  {
    label: 'Operación',
    items: [
      { id: 'ventas', label: 'Ventas', icon: ReceiptText, permission: 'documents.read' },
      { id: 'compras', label: 'Compras', icon: ShoppingCart, permission: 'documents.read' },
      { id: 'nc', label: 'Notas crédito', icon: RotateCcw, permission: 'documents.read' },
      { id: 'dse', label: 'Documento soporte', icon: FileCheck2, permission: 'documents.read' },
      { id: 'nomina', label: 'Nómina', icon: Users, permission: 'documents.read' },
    ],
  },
  {
    label: 'Fiscal',
    items: [
      { id: 'iva', label: 'IVA', icon: Landmark, permission: 'reports.read' },
      { id: 'retenciones', label: 'Retenciones', icon: Percent, permission: 'reports.read' },
      { id: 'conciliacion', label: 'Conciliación', icon: Scale, permission: 'reports.read' },
      { id: 'obligaciones', label: 'Obligaciones', icon: CalendarClock, permission: 'reports.read' },
    ],
  },
  {
    label: 'Análisis',
    items: [
      { id: 'terceros', label: 'Terceros', icon: Building2, permission: 'reports.read' },
      { id: 'reportes', label: 'Reportes', icon: FileText, permission: 'reports.read' },
    ],
  },
  {
    label: 'Sistema',
    items: [
      {
        id: 'fuentes',
        label: 'Fuentes de datos',
        icon: Database,
        permission: ['radian.read', 'radian.import'],
      },
      {
        id: 'configuracion',
        label: 'Configuración',
        icon: Settings,
        permission: ['settings.read', 'integrations.read', 'sync.read', 'users.read', 'audit.read', 'sessions.read'],
      },
      {
        id: 'usuarios-acceso',
        label: 'Usuarios y acceso',
        icon: Users,
        permission: ['users.read', 'sessions.read', 'audit.read'],
      },
    ],
  },
];

export function itemAllowed(item: NavItem, hasPermission: (code: string) => boolean): boolean {
  if (!item.permission) return true;
  const codes = Array.isArray(item.permission) ? item.permission : [item.permission];
  return codes.some((code) => hasPermission(code));
}

export function allowedGroups(hasPermission: (code: string) => boolean): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => itemAllowed(item, hasPermission)),
  })).filter((group) => group.items.length > 0);
}

export function isViewAllowed(view: ViewId, hasPermission: (code: string) => boolean): boolean {
  return NAV_GROUPS.some((group) =>
    group.items.some((item) => item.id === view && itemAllowed(item, hasPermission)),
  );
}
