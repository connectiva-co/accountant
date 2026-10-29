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
  actor_user_id: string | null;
  target_user_id: string | null;
  ip: string | null;
  user_agent: string | null;
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

/* ------------------------------------------------------------------ */
/* Integraciones (migración 0004)                                      */
/* ------------------------------------------------------------------ */

export interface IntegrationProvidersTable {
  id: Generated<string>;
  code: string;
  name: string;
  enabled: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface CompanyIntegrationsTable {
  id: Generated<string>;
  company_id: string;
  provider_id: string;
  name: string | null;
  enabled: Generated<boolean>;
  status: Generated<string>;
  last_connection_test_at: TimestamptzNull;
  last_test_status: string | null;
  last_test_message: string | null;
  last_successful_connection_at: TimestamptzNull;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface IntegrationSettingsTable {
  id: Generated<string>;
  company_integration_id: string;
  settings: Generated<Json>;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface IntegrationSecretsTable {
  id: Generated<string>;
  company_integration_id: string;
  encrypted_payload: string;
  nonce: Buffer;
  auth_tag: Buffer;
  encryption_key_version: number;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface IntegrationSyncStateTable {
  id: Generated<string>;
  company_integration_id: string;
  resource: string;
  last_synced_at: TimestamptzNull;
  cursor: Json | null;
  metadata: Generated<Json>;
  updated_at: Timestamptz;
}

export interface IntegrationRunsTable {
  id: Generated<string>;
  company_id: string;
  company_integration_id: string | null;
  operation: string;
  started_at: CreatedAt;
  finished_at: TimestamptzNull;
  status: Generated<string>;
  records_read: Generated<number>;
  records_matched: Generated<number>;
  records_not_found: Generated<number>;
  records_failed: Generated<number>;
  error_summary: string | null;
  metadata: Generated<Json>;
}

export interface DocumentIntegrationMatchesTable {
  id: Generated<string>;
  company_id: string;
  document_id: string;
  company_integration_id: string;
  external_id: string | null;
  external_document_type: string | null;
  external_number: string | null;
  match_status: Generated<string>;
  match_method: string | null;
  confidence: ColumnType<string | number | null, string | number | null, string | number | null>;
  matched_at: TimestamptzNull;
  last_checked_at: TimestamptzNull;
  external_payload: Json | null;
  error_message: string | null;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface SyncPoliciesTable {
  id: Generated<string>;
  company_id: string;
  resource_type: string;
  enabled: Generated<boolean>;
  master_source: Generated<string>;
  sync_mode: Generated<string>;
  conflict_strategy: Generated<string>;
  schedule_type: string | null;
  schedule_expression: string | null;
  last_run_at: TimestamptzNull;
  next_run_at: TimestamptzNull;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface SyncRoutesTable {
  id: Generated<string>;
  sync_policy_id: string;
  source_integration_id: string | null;
  target_integration_id: string | null;
  read_enabled: Generated<boolean>;
  write_enabled: Generated<boolean>;
  priority: Generated<number>;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface SyncMappingsTable {
  id: Generated<string>;
  company_id: string;
  resource_type: string;
  mapping_type: string;
  source_provider: Generated<string>;
  target_provider: Generated<string>;
  source_value: string;
  target_value: string;
  metadata: Generated<Json>;
  enabled: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface EntityExternalRefsTable {
  id: Generated<string>;
  company_id: string;
  entity_type: string;
  entity_id: string;
  company_integration_id: string;
  external_id: string;
  external_code: string | null;
  last_seen_at: Timestamptz;
  source_hash: string | null;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface SyncConflictsTable {
  id: Generated<string>;
  company_id: string;
  resource_type: string;
  entity_type: Generated<string>;
  entity_id: string;
  source_integration_id: string | null;
  target_integration_id: string | null;
  source_payload: Generated<Json>;
  target_payload: Generated<Json>;
  conflict_type: Generated<string>;
  status: Generated<string>;
  resolution: string | null;
  resolved_at: TimestamptzNull;
  resolved_by: string | null;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

/* ------------------------------------------------------------------ */
/* Auth / RBAC (migración 0005)                                        */
/* ------------------------------------------------------------------ */

export type UserStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED' | 'LOCKED';
export type MembershipStatus = 'INVITED' | 'ACTIVE' | 'DISABLED';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface UsersTable {
  id: Generated<string>;
  email: string;
  full_name: Generated<string>;
  password_hash: string;
  status: Generated<UserStatus>;
  must_change_password: Generated<boolean>;
  platform_admin: Generated<boolean>;
  two_factor_enabled: Generated<boolean>;
  failed_attempts: Generated<number>;
  locked_until: TimestamptzNull;
  last_login_at: TimestamptzNull;
  last_login_ip: string | null;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface CompanyMembershipsTable {
  id: Generated<string>;
  company_id: string;
  user_id: string;
  status: Generated<MembershipStatus>;
  disabled_at: TimestamptzNull;
  disabled_by: string | null;
  disabled_reason: string | null;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface RolesTable {
  id: Generated<string>;
  company_id: string | null;
  code: string;
  name: string;
  description: string | null;
  is_system: Generated<boolean>;
  is_editable: Generated<boolean>;
  active: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface MembershipRolesTable {
  membership_id: string;
  role_id: string;
  created_at: CreatedAt;
}

export interface PermissionsTable {
  id: Generated<string>;
  code: string;
  name: string;
  description: string | null;
  category: string;
  risk_level: Generated<RiskLevel>;
  requires_step_up: Generated<boolean>;
  created_at: CreatedAt;
}

export interface RolePermissionsTable {
  role_id: string;
  permission_id: string;
}

export interface UserMfaMethodsTable {
  id: Generated<string>;
  user_id: string;
  type: Generated<string>;
  status: Generated<string>;
  encrypted_secret: string;
  verified_at: TimestamptzNull;
  last_used_at: TimestamptzNull;
  created_at: CreatedAt;
}

export interface UserRecoveryCodesTable {
  id: Generated<string>;
  user_id: string;
  code_hash: string;
  used_at: TimestamptzNull;
  created_at: CreatedAt;
}

export interface UserSessionsTable {
  id: Generated<string>;
  user_id: string;
  session_token_hash: string;
  refresh_token_hash: string;
  csrf_token_hash: string;
  ip: string | null;
  user_agent: string | null;
  created_at: CreatedAt;
  last_used_at: Generated<Date>;
  last_auth_at: Generated<Date>;
  expires_at: Timestamptz;
  refresh_expires_at: Timestamptz;
  revoked_at: TimestamptzNull;
  revoked_reason: string | null;
}

export interface LoginAttemptsTable {
  id: Generated<number>;
  email: string;
  user_id: string | null;
  ip: string | null;
  user_agent: string | null;
  success: boolean;
  failure_reason: string | null;
  created_at: CreatedAt;
}

export interface SchemaMigrationsTable {
  name: string;
  checksum: string;
  applied_at: CreatedAt;
}


export type PersonType = 'NATURAL' | 'JURIDICA';
export type TaxRegime = 'ORDINARIO' | 'SIMPLE' | 'ESPECIAL' | 'NO_RESPONSABLE';
export type RateBasis = 'PERCENT' | 'PER_MILLE';
export type DeterminationStatus =
  | 'CALCULATED'
  | 'EXEMPT'
  | 'NOT_APPLICABLE'
  | 'MISSING_PROFILE'
  | 'NO_MATCHING_RULE'
  | 'REQUIRES_REVIEW'
  | 'MANUALLY_OVERRIDDEN';

export interface TaxResponsibilitiesTable {
  id: Generated<string>;
  code: string;
  name: string;
  description: string | null;
  created_at: CreatedAt;
}

export interface TaxConceptsTable {
  id: Generated<string>;
  code: string;
  name: string;
  tax_type_id: string;
  description: string | null;
  active: Generated<boolean>;
  created_at: CreatedAt;
}

export interface ThirdPartyTaxProfilesTable {
  id: Generated<string>;
  company_id: string;
  third_party_id: string;
  person_type: Generated<PersonType>;
  tax_regime: Generated<TaxRegime>;
  economic_activity_code: string | null;
  ica_municipality_code: Generated<string>;
  is_declarant_renta: Generated<boolean>;
  valid_from: ColumnType<string, string | undefined, string>;
  valid_to: ColumnType<string, string | undefined, string>;
  metadata: Generated<Json>;
  created_at: CreatedAt;
  updated_at: Timestamptz;
}

export interface ThirdPartyTaxResponsibilitiesTable {
  profile_id: string;
  responsibility_id: string;
  created_at: CreatedAt;
}

export interface TaxRulesTable {
  id: Generated<string>;
  company_id: string | null;
  tax_type_id: string;
  tax_concept_id: string;
  municipality_code: string | null;
  person_type: PersonType | null;
  is_declarant_renta: boolean | null;
  tax_regime: TaxRegime | null;
  required_responsibility_id: string | null;
  excluded_responsibility_id: string | null;
  min_base_cop: Generated<number>;
  rate: number;
  rate_basis: Generated<RateBasis>;
  effective_from: ColumnType<string, string | undefined, string>;
  effective_to: ColumnType<string, string | undefined, string>;
  priority: Generated<number>;
  legal_reference: string | null;
  explanation: string | null;
  enabled: Generated<boolean>;
  created_at: CreatedAt;
}

export interface DocumentTaxDeterminationsTable {
  id: Generated<string>;
  company_id: string;
  document_id: string;
  tax_type_id: string;
  tax_concept_id: string | null;
  tax_rule_id: string | null;
  taxable_base: Generated<number>;
  rate: Generated<number>;
  amount: Generated<number>;
  status: DeterminationStatus;
  source: Generated<'ENGINE' | 'MANUAL'>;
  profile_snapshot: Generated<Json>;
  rule_snapshot: Generated<Json>;
  explanation: string | null;
  override_reason: string | null;
  override_rate: number | null;
  override_amount: number | null;
  calculated_by: string | null;
  calculated_at: Timestamptz;
}

export interface CompanyTaxConfigurationsTable {
  id: Generated<string>;
  company_id: string;
  tax_type_id: string;
  operation_type: Generated<'ISSUED' | 'RECEIVED' | 'ALL'>;
  document_category: Generated<'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'SUPPORT' | 'ALL'>;
  is_enabled: Generated<boolean>;
  default_rate: number | null;
  rate_basis: Generated<RateBasis>;
  default_concept_id: string | null;
  min_base_cop: Generated<number>;
  applies_to_declarant: boolean | null;
  metadata: Generated<Json>;
  created_at: CreatedAt;
  updated_at: Timestamptz;
}

export interface ThirdPartyTaxRulesTable {
  id: Generated<string>;
  company_id: string;
  third_party_id: string;
  tax_type_id: string;
  operation_type: Generated<'ISSUED' | 'RECEIVED' | 'ALL'>;
  document_category: Generated<'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'SUPPORT' | 'ALL'>;
  is_exempt: Generated<boolean>;
  custom_rate: number | null;
  rate_basis: Generated<RateBasis>;
  custom_concept_id: string | null;
  municipality_code: string | null;
  notes: string | null;
  valid_from: ColumnType<string, string | undefined, string>;
  valid_to: ColumnType<string, string | undefined, string>;
  created_at: CreatedAt;
  updated_at: Timestamptz;
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
  integration_providers: IntegrationProvidersTable;
  company_integrations: CompanyIntegrationsTable;
  integration_settings: IntegrationSettingsTable;
  integration_secrets: IntegrationSecretsTable;
  integration_sync_state: IntegrationSyncStateTable;
  integration_runs: IntegrationRunsTable;
  document_integration_matches: DocumentIntegrationMatchesTable;
  sync_policies: SyncPoliciesTable;
  sync_routes: SyncRoutesTable;
  sync_mappings: SyncMappingsTable;
  entity_external_refs: EntityExternalRefsTable;
  sync_conflicts: SyncConflictsTable;
  users: UsersTable;
  company_memberships: CompanyMembershipsTable;
  roles: RolesTable;
  membership_roles: MembershipRolesTable;
  permissions: PermissionsTable;
  role_permissions: RolePermissionsTable;
  user_mfa_methods: UserMfaMethodsTable;
  user_recovery_codes: UserRecoveryCodesTable;
  user_sessions: UserSessionsTable;
  login_attempts: LoginAttemptsTable;
  schema_migrations: SchemaMigrationsTable;
  tax_responsibilities: TaxResponsibilitiesTable;
  tax_concepts: TaxConceptsTable;
  third_party_tax_profiles: ThirdPartyTaxProfilesTable;
  third_party_tax_responsibilities: ThirdPartyTaxResponsibilitiesTable;
  tax_rules: TaxRulesTable;
  document_tax_determinations: DocumentTaxDeterminationsTable;
  company_tax_configurations: CompanyTaxConfigurationsTable;
  third_party_tax_rules: ThirdPartyTaxRulesTable;
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

export type IntegrationProviderRow = Selectable<IntegrationProvidersTable>;
export type CompanyIntegration = Selectable<CompanyIntegrationsTable>;
export type NewCompanyIntegration = Insertable<CompanyIntegrationsTable>;
export type CompanyIntegrationUpdate = Updateable<CompanyIntegrationsTable>;
export type IntegrationRun = Selectable<IntegrationRunsTable>;
export type NewIntegrationRun = Insertable<IntegrationRunsTable>;
export type IntegrationRunUpdate = Updateable<IntegrationRunsTable>;
export type DocumentIntegrationMatch = Selectable<DocumentIntegrationMatchesTable>;
export type NewDocumentIntegrationMatch = Insertable<DocumentIntegrationMatchesTable>;
export type DocumentIntegrationMatchUpdate = Updateable<DocumentIntegrationMatchesTable>;
export type SyncPolicy = Selectable<SyncPoliciesTable>;
export type NewSyncPolicy = Insertable<SyncPoliciesTable>;
export type SyncPolicyUpdate = Updateable<SyncPoliciesTable>;
export type SyncRoute = Selectable<SyncRoutesTable>;
export type NewSyncRoute = Insertable<SyncRoutesTable>;
export type SyncMapping = Selectable<SyncMappingsTable>;
export type NewSyncMapping = Insertable<SyncMappingsTable>;
export type EntityExternalRef = Selectable<EntityExternalRefsTable>;
export type NewEntityExternalRef = Insertable<EntityExternalRefsTable>;
export type SyncConflict = Selectable<SyncConflictsTable>;
export type NewSyncConflict = Insertable<SyncConflictsTable>;

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type CompanyMembership = Selectable<CompanyMembershipsTable>;
export type NewCompanyMembership = Insertable<CompanyMembershipsTable>;
export type Role = Selectable<RolesTable>;
export type NewRole = Insertable<RolesTable>;
export type Permission = Selectable<PermissionsTable>;
export type UserSession = Selectable<UserSessionsTable>;
export type LoginAttempt = Insertable<LoginAttemptsTable>;

export type TaxResponsibility = Selectable<TaxResponsibilitiesTable>;
export type NewTaxResponsibility = Insertable<TaxResponsibilitiesTable>;

export type TaxConcept = Selectable<TaxConceptsTable>;
export type NewTaxConcept = Insertable<TaxConceptsTable>;

export type ThirdPartyTaxProfile = Selectable<ThirdPartyTaxProfilesTable>;
export type NewThirdPartyTaxProfile = Insertable<ThirdPartyTaxProfilesTable>;
export type ThirdPartyTaxProfileUpdate = Updateable<ThirdPartyTaxProfilesTable>;

export type ThirdPartyTaxResponsibility = Selectable<ThirdPartyTaxResponsibilitiesTable>;
export type NewThirdPartyTaxResponsibility = Insertable<ThirdPartyTaxResponsibilitiesTable>;

export type TaxRule = Selectable<TaxRulesTable>;
export type NewTaxRule = Insertable<TaxRulesTable>;
export type TaxRuleUpdate = Updateable<TaxRulesTable>;

export type DocumentTaxDetermination = Selectable<DocumentTaxDeterminationsTable>;
export type NewDocumentTaxDetermination = Insertable<DocumentTaxDeterminationsTable>;
export type DocumentTaxDeterminationUpdate = Updateable<DocumentTaxDeterminationsTable>;

export type CompanyTaxConfiguration = Selectable<CompanyTaxConfigurationsTable>;
export type NewCompanyTaxConfiguration = Insertable<CompanyTaxConfigurationsTable>;
export type CompanyTaxConfigurationUpdate = Updateable<CompanyTaxConfigurationsTable>;

export type ThirdPartyTaxRule = Selectable<ThirdPartyTaxRulesTable>;
export type NewThirdPartyTaxRule = Insertable<ThirdPartyTaxRulesTable>;
export type ThirdPartyTaxRuleUpdate = Updateable<ThirdPartyTaxRulesTable>;
