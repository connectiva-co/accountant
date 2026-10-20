export interface ParsedUblLine {
  id: string;
  description: string;
  quantity: number;
  unitCode: string;
  unitPrice: number;
  subtotal: number;
  taxes: Array<{
    name: string;
    percent: number;
    amount: number;
  }>;
}

export interface ParsedUblTax {
  name: string;
  code?: string;
  percent: number;
  taxableAmount: number;
  taxAmount: number;
}

export interface ParsedUblInvoice {
  id: string;
  issueDate: string;
  issueTime: string;
  cufe: string;
  currency: string;
  notes: string[];
  supplier: {
    taxId: string;
    dv?: string;
    name: string;
    commercialName?: string;
    address?: string;
    city?: string;
    department?: string;
    email?: string;
    phone?: string;
  };
  customer: {
    taxId: string;
    dv?: string;
    name: string;
    address?: string;
    city?: string;
    department?: string;
    email?: string;
    phone?: string;
  };
  lines: ParsedUblLine[];
  taxes: ParsedUblTax[];
  totals: {
    lineExtensionAmount: number;
    taxExclusiveAmount: number;
    taxInclusiveAmount: number;
    payableAmount: number;
  };
}

function tagVal(xml: string, tag: string): string | null {
  if (!xml) return null;
  const reg = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tag}>`);
  const m = xml.match(reg);
  return m ? m[1].trim() : null;
}

function tagAttr(xml: string, tag: string, attr: string): string | null {
  if (!xml) return null;
  const reg = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tag}[^>]*\\b${attr}="([^"]+)"`);
  const m = xml.match(reg);
  return m ? m[1] : null;
}

function extractAll(xml: string, tag: string): string[] {
  if (!xml) return [];
  const reg = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tag}[^>]*>[\\s\\S]*?<\\/(?:[a-zA-Z0-9_-]+:)?${tag}>`, 'g');
  return xml.match(reg) || [];
}

export function parseUblInvoice(rawXml: string): ParsedUblInvoice {
  let invoiceXml = rawXml;
  const cdataMatch = rawXml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdataMatch && (cdataMatch[1].includes('<Invoice') || cdataMatch[1].includes('<fe:Invoice'))) {
    invoiceXml = cdataMatch[1].trim();
  } else {
    const invMatch = rawXml.match(/<(?:[a-zA-Z0-9_-]+:)?Invoice[\s\S]*?<\/(?:[a-zA-Z0-9_-]+:)?Invoice>/);
    if (invMatch) {
      invoiceXml = invMatch[0];
    }
  }

  const id = tagVal(invoiceXml, 'ID') || '';
  const issueDate = tagVal(invoiceXml, 'IssueDate') || '';
  const issueTime = tagVal(invoiceXml, 'IssueTime') || '';
  const cufe = tagVal(invoiceXml, 'UUID') || '';
  const currency = tagAttr(invoiceXml, 'DocumentCurrencyCode', 'listID') || tagVal(invoiceXml, 'DocumentCurrencyCode') || 'COP';
  const notes = extractAll(invoiceXml, 'Note').map(n => tagVal(n, 'Note') || '').filter(Boolean);

  // Supplier
  const supplierChunk = tagVal(invoiceXml, 'AccountingSupplierParty') || '';
  const supplierParty = tagVal(supplierChunk, 'Party') || supplierChunk;
  const supplierTaxIdChunk = tagVal(supplierParty, 'PartyTaxScheme') || supplierParty;
  const supplierTaxId = tagVal(supplierTaxIdChunk, 'CompanyID') || '';
  const supplierDv = tagAttr(supplierTaxIdChunk, 'CompanyID', 'schemeID') || undefined;
  const supplierName = tagVal(supplierParty, 'RegistrationName') || '';
  const supplierCommercial = tagVal(supplierParty, 'CommercialName') || undefined;
  const supplierAddress = tagVal(supplierParty, 'Line') || undefined;
  const supplierCity = tagVal(supplierParty, 'CityName') || undefined;
  const supplierDept = tagVal(supplierParty, 'CountrySubentity') || undefined;

  // Customer
  const customerChunk = tagVal(invoiceXml, 'AccountingCustomerParty') || '';
  const customerParty = tagVal(customerChunk, 'Party') || customerChunk;
  const customerTaxIdChunk = tagVal(customerParty, 'PartyTaxScheme') || customerParty;
  const customerTaxId = tagVal(customerTaxIdChunk, 'CompanyID') || '';
  const customerDv = tagAttr(customerTaxIdChunk, 'CompanyID', 'schemeID') || undefined;
  const customerName = tagVal(customerParty, 'RegistrationName') || '';
  const customerEmail = tagVal(customerParty, 'ElectronicMail') || undefined;
  const customerPhone = tagVal(customerParty, 'Telephone') || undefined;
  const customerAddress = tagVal(customerParty, 'Line') || undefined;
  const customerCity = tagVal(customerParty, 'CityName') || undefined;
  const customerDept = tagVal(customerParty, 'CountrySubentity') || undefined;

  // Lines
  const lineChunks = extractAll(invoiceXml, 'InvoiceLine');
  const lines: ParsedUblLine[] = lineChunks.map((chunk, idx) => {
    const lineId = tagVal(chunk, 'ID') || String(idx + 1);
    const itemChunk = tagVal(chunk, 'Item') || '';
    const description = tagVal(itemChunk, 'Description') || tagVal(chunk, 'Note') || 'Ítem de venta';
    const quantity = parseFloat(tagVal(chunk, 'InvoicedQuantity') || '1');
    const unitCode = tagAttr(chunk, 'InvoicedQuantity', 'unitCode') || 'UN';
    const lineExtension = parseFloat(tagVal(chunk, 'LineExtensionAmount') || '0');
    const priceChunk = tagVal(chunk, 'Price') || '';
    const unitPrice = parseFloat(tagVal(priceChunk, 'PriceAmount') || (quantity > 0 ? (lineExtension / quantity).toFixed(2) : '0'));

    const taxSubChunks = extractAll(chunk, 'TaxSubtotal');
    const taxes = taxSubChunks.map(sub => {
      const name = tagVal(sub, 'Name') || 'IVA';
      const percent = parseFloat(tagVal(sub, 'Percent') || '0');
      const amount = parseFloat(tagVal(sub, 'TaxAmount') || '0');
      return { name, percent, amount };
    });

    return {
      id: lineId,
      description,
      quantity,
      unitCode,
      unitPrice,
      subtotal: lineExtension,
      taxes,
    };
  });

  // Global taxes
  const rootTaxSubChunks = extractAll(invoiceXml, 'TaxSubtotal');
  const taxes: ParsedUblTax[] = [];
  for (const sub of rootTaxSubChunks) {
    const name = tagVal(sub, 'Name') || 'IVA';
    const code = tagVal(sub, 'ID') || undefined;
    const percent = parseFloat(tagVal(sub, 'Percent') || '0');
    const taxableAmount = parseFloat(tagVal(sub, 'TaxableAmount') || '0');
    const taxAmount = parseFloat(tagVal(sub, 'TaxAmount') || '0');
    if (taxAmount > 0 || taxableAmount > 0) {
      taxes.push({ name, code, percent, taxableAmount, taxAmount });
    }
  }

  // Monetary Totals
  const monChunk = tagVal(invoiceXml, 'LegalMonetaryTotal') || '';
  const lineExtensionAmount = parseFloat(tagVal(monChunk, 'LineExtensionAmount') || '0');
  const taxExclusiveAmount = parseFloat(tagVal(monChunk, 'TaxExclusiveAmount') || '0');
  const taxInclusiveAmount = parseFloat(tagVal(monChunk, 'TaxInclusiveAmount') || '0');
  const payableAmount = parseFloat(tagVal(monChunk, 'PayableAmount') || '0');

  return {
    id,
    issueDate,
    issueTime,
    cufe,
    currency,
    notes,
    supplier: {
      taxId: supplierTaxId,
      dv: supplierDv,
      name: supplierName,
      commercialName: supplierCommercial,
      address: supplierAddress,
      city: supplierCity,
      department: supplierDept,
    },
    customer: {
      taxId: customerTaxId,
      dv: customerDv,
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
      address: customerAddress,
      city: customerCity,
      department: customerDept,
    },
    lines,
    taxes,
    totals: {
      lineExtensionAmount,
      taxExclusiveAmount,
      taxInclusiveAmount,
      payableAmount,
    },
  };
}
