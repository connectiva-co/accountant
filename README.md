# RADIAN Analytics Pro - DIAN Facturación & Impuestos

Dashboard interactivo y robusto construido en **React + TypeScript + Tailwind CSS** para el procesamiento, análisis, conciliación y exportación de reportes **RADIAN / DIAN** de Facturación Electrónica.

## Características

- 📊 **Dashboard Ejecutivo**: KPIs en tiempo real (Ventas emitidas, Compras recibidas, Balance de IVA, Nómina y Documentos soporte).
- 📈 **Gráficos Interactivos**:
  - Evolución diaria de Ventas vs Compras.
  - Composición de Impuestos (IVA, INC, IBUA, ReteFuente, ReteIVA, ReteICA).
  - Top 10 Clientes y Proveedores por volumen.
- 🗂️ **Vistas Segregadas por Pestaña**:
  - **Ventas (Emitidas)**: Con cálculo automático de Base Gravable.
  - **Compras (Recibidas)**: Costos y deducciones con IVA descontable.
  - **Notas Crédito**: Separación de devoluciones en ventas y descuentos en compras.
  - **Documento Soporte (DSE)**: Transacciones con personas naturales no obligadas.
  - **Nómina & POS**: Costo laboral y facturación de caja menor.
  - **Conciliación Fiscal DIAN**: Simulación del Formulario 300 de IVA.
- 📥 **Carga de Archivos**: Drag & drop para cualquier reporte `.xlsx` o `.csv` de la DIAN.
- 📤 **Exportador Multi-Tab**: Descarga de un archivo Excel consolidado con hojas separadas para cada categoría.

## Inicio Rápido

```bash
cd ~/Development/radian-dashboard
npm install
npm run dev
```

Desarrollado por [Connectiva](https://connectiva.co)
