import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

/** TIMESTAMPTZ: selecciona como Date; la app lo escribe/actualiza. */
type Timestamptz = ColumnType<Date, Date | string | undefined, Date | string>;
/** TIMESTAMPTZ nullable. */
type TimestamptzNull = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
/** TIMESTAMPTZ con DEFAULT now() gestionado en BD (no se escribe desde la app). */
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;
/** DATE de Postgres: node-postgres lo devuelve como 'YYYY-MM-DD'. */
type SqlDateNull = ColumnType<string | null, string | null | undefined, string | null>;

export type ImportStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'FAILED';
export type Direction = 'ISSUED' | 'RECEIVED' | 'UNKNOWN';
export type Severity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
export type RowStatus = 'PENDING' | 'INSERTED' | 'UNCHANGED' | 'UPDATED' | 'REJECTED' | 'ERROR';
export type DocumentCategory = 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'SUPPORT' | 'PAYROLL' | 'EVENT' | 'OTHER';
export type TaxCategory = 'VAT' | 'INDIRECT' | 'WITHHOLDING' | 'OTHER';

export interface CompaniesTable {
  id: Generated<string>;
  nit: string;
  legal_name: string;
  trade_name: string | null;
  currency: Generated<string>;
  timezone: Generated<string>;
  active: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface ImportsTable {
  id: Generated<string>;
  company_id: string;
  source: Generated<string>;
  filename: string;
  file_sha256: string;
  started_at: CreatedAt;
  completed_at: TimestamptzNull;
  status: Generated<ImportStatus>;
  rows_total: Generated<number>;
  rows_inserted: Generated<number>;
  rows_updated: Generated<number>;
  rows_unchanged: Generated<number>;
  rows_rejected: Generated<number>;
  warnings_count: Generated<number>;
  error_message: string | null;
  created_by: string | null;
  created_at: CreatedAt;
}

export interface ThirdPartiesTable {
  id: Generated<string>;
  company_id: string;
  tax_id: string;
  check_digit: string | null;
  legal_name: string | null;
  normalized_name: string | null;
  first_seen_at: CreatedAt;
  last_seen_at: Timestamptz;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface ThirdPartyHistoryTable {
  id: Generated<string>;
  third_party_id: string;
  valid_from: CreatedAt;
  valid_to: TimestamptzNull;
  tax_id: string | null;
  legal_name: string | null;
  normalized_name: string | null;
  payload: Generated<Json>;
  source_import_id: string | null;
  created_at: CreatedAt;
}

export interface DocumentTypesTable {
  id: Generated<string>;
  code: string;
  name: string;
  category: DocumentCategory;
  is_economic_document: Generated<boolean>;
  active: Generated<boolean>;
  created_at: CreatedAt;
}

export interface TaxTypesTable {
  id: Generated<string>;
  code: string;
  name: string;
  category: TaxCategory;
  active: Generated<boolean>;
  created_at: CreatedAt;
}

export interface DocumentsTable {
  id: Generated<string>;
  company_id: string;
  external_uid: string;
  document_type_id: string;
  folio: string | null;
  prefix: string | null;
  currency: Generated<string>;
  payment_form: string | null;
  payment_method: string | null;
  issued_at: SqlDateNull;
  received_at: TimestamptzNull;
  issuer_id: string | null;
  receiver_id: string | null;
  total: Generated<number>;
  direction: Generated<Direction>;
  status: Generated<string>;
  source: Generated<string>;
  source_hash: string;
  first_seen_import_id: string | null;
  last_seen_import_id: string | null;
  is_active: Generated<boolean>;
  superseded_at: TimestamptzNull;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface DocumentVersionsTable {
  id: Generated<string>;
  document_id: string;
  version_number: number;
  source_hash: string;
  snapshot: Json;
  import_id: string | null;
  created_at: CreatedAt;
}

export interface DocumentStatusHistoryTable {
  id: Generated<string>;
  document_id: string;
  status: string;
  observed_at: CreatedAt;
  import_id: string | null;
  created_at: CreatedAt;
}

export interface DocumentTaxesTable {
  id: Generated<string>;
  document_id: string;
  tax_type_id: string;
  taxable_base: number | null;
  rate: number | null;
  amount: Generated<number>;
  created_at: CreatedAt;
}

export interface DocumentEventsTable {
  id: Generated<string>;
  company_id: string;
  document_id: string | null;
  event_uid: string;
  event_type: string;
  status: string | null;
  occurred_at: TimestamptzNull;
  issuer_id: string | null;
  receiver_id: string | null;
  source_payload: Generated<Json>;
  import_id: string | null;
  created_at: CreatedAt;
}

export interface ImportRowsTable {
  id: Generated<number>;
  import_id: string;
  row_number: number;
  external_uid: string | null;
  raw_payload: Json;
  processing_status: Generated<RowStatus>;
  error_code: string | null;
  error_message: string | null;
  document_id: string | null;
  created_at: CreatedAt;
}

export interface ValidationIssuesTable {
  id: Generated<string>;
  company_id: string;
  document_id: string | null;
  import_row_id: number | null;
  import_id: string | null;
  rule_code: string;
  severity: Severity;
  message: string;
  details: Generated<Json>;
  resolved_at: TimestamptzNull;
  resolved_by: string | null;
  created_at: CreatedAt;
}

export interface SettingsTable {
  id: Generated<string>;
  company_id: string | null;
  scope: string;
  key: string;
  value: Json;
  value_type: string | null;
  description: string | null;
  is_system: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface AuditLogTable {
  id: Generated<number>;
  company_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_type: Generated<string>;
  actor_id: string | null;
  before: Json | null;
  after: Json | null;
  metadata: Generated<Json>;
  created_at: CreatedAt;
}

export interface ReportingMonthlyTable {
  company_id: string;
  year: number;
  month: number;
  sales_count: Generated<number>;
  sales_total: Generated<number>;
  purchase_count: Generated<number>;
  purchase_total: Generated<number>;
  credit_notes_count: Generated<number>;
  credit_notes_total: Generated<number>;
  payroll_count: Generated<number>;
  payroll_total: Generated<number>;
  support_documents_count: Generated<number>;
  support_documents_total: Generated<number>;
  vat_generated: Generated<number>;
  vat_deductible: Generated<number>;
  withholding_total: Generated<number>;
  unique_customers: Generated<number>;
  unique_suppliers: Generated<number>;
  documents_count: Generated<number>;
  documents_with_issues: Generated<number>;
  updated_at: Timestamptz;
}

export interface ReportingCounterpartyMonthlyTable {
  company_id: string;
  third_party_id: string;
  year: number;
  month: number;
  sales_count: Generated<number>;
  sales_total: Generated<number>;
  purchase_count: Generated<number>;
  purchase_total: Generated<number>;
  credit_notes_count: Generated<number>;
  credit_notes_total: Generated<number>;
  tax_total: Generated<number>;
  first_transaction_date: SqlDateNull;
  last_transaction_date: SqlDateNull;
  updated_at: Timestamptz;
}

export interface ReportingTaxMonthlyTable {
  company_id: string;
  tax_type_id: string;
  year: number;
  month: number;
  direction: Direction;
  document_count: Generated<number>;
  taxable_base: number | null;
  tax_amount: Generated<number>;
  updated_at: Timestamptz;
}

export interface SchemaMigrationsTable {
  name: string;
  checksum: string;
  applied_at: CreatedAt;
}

export interface Database {
  companies: CompaniesTable;
  imports: ImportsTable;
  third_parties: ThirdPartiesTable;
  third_party_history: ThirdPartyHistoryTable;
  document_types: DocumentTypesTable;
  tax_types: TaxTypesTable;
  documents: DocumentsTable;
  document_versions: DocumentVersionsTable;
  document_status_history: DocumentStatusHistoryTable;
  document_taxes: DocumentTaxesTable;
  document_events: DocumentEventsTable;
  import_rows: ImportRowsTable;
  validation_issues: ValidationIssuesTable;
  settings: SettingsTable;
  audit_log: AuditLogTable;
  reporting_monthly: ReportingMonthlyTable;
  reporting_counterparty_monthly: ReportingCounterpartyMonthlyTable;
  reporting_tax_monthly: ReportingTaxMonthlyTable;
  schema_migrations: SchemaMigrationsTable;
}

export type Company = Selectable<CompaniesTable>;
export type NewCompany = Insertable<CompaniesTable>;
export type CompanyUpdate = Updateable<CompaniesTable>;

export type ThirdParty = Selectable<ThirdPartiesTable>;
export type NewThirdParty = Insertable<ThirdPartiesTable>;

export type Document = Selectable<DocumentsTable>;
export type NewDocument = Insertable<DocumentsTable>;
export type DocumentUpdate = Updateable<DocumentsTable>;

export type DocumentTax = Selectable<DocumentTaxesTable>;
export type NewDocumentTax = Insertable<DocumentTaxesTable>;

export type DocumentEvent = Selectable<DocumentEventsTable>;
export type NewDocumentEvent = Insertable<DocumentEventsTable>;

export type Import = Selectable<ImportsTable>;
export type NewImport = Insertable<ImportsTable>;
export type ImportUpdate = Updateable<ImportsTable>;

export type ImportRow = Selectable<ImportRowsTable>;
export type NewImportRow = Insertable<ImportRowsTable>;

export type ValidationIssue = Selectable<ValidationIssuesTable>;
export type NewValidationIssue = Insertable<ValidationIssuesTable>;

export type Setting = Selectable<SettingsTable>;
export type NewSetting = Insertable<SettingsTable>;

export type DocumentType = Selectable<DocumentTypesTable>;
export type TaxType = Selectable<TaxTypesTable>;

export type ReportingMonthly = Selectable<ReportingMonthlyTable>;
export type NewReportingMonthly = Insertable<ReportingMonthlyTable>;
export type ReportingCounterpartyMonthly = Selectable<ReportingCounterpartyMonthlyTable>;
export type NewReportingCounterpartyMonthly = Insertable<ReportingCounterpartyMonthlyTable>;
export type ReportingTaxMonthly = Selectable<ReportingTaxMonthlyTable>;
export type NewReportingTaxMonthly = Insertable<ReportingTaxMonthlyTable>;

export type AuditEntry = Insertable<AuditLogTable>;
