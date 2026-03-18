# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-03-18

### Added
- **Polling Triggers** — New NetSuite Trigger node that monitors records for creation/modification using SuiteQL
  - Three event types: Record Created, Record Updated, Record Created or Updated
  - Dynamic record type dropdown with metadata catalog integration
  - Configurable date fields for custom records
  - Additional SuiteQL WHERE clause filters
  - Configurable manual test lookback period
  - Automatic pagination for large result sets
  - Debug metadata (`_triggerMeta`) included in trigger output
- **SuiteQL Query Templates** — Built-in templates for common queries: Active Customers, Recent Sales Orders, Open Invoices, Inventory Levels, Employee Directory, Vendor Bills
- **Contextual Hints** — In-node guidance for Restlet, SuiteQL, Create, and Trigger operations with links to SolutionLab services
- **AI Agent Support** — `usableAsTool: true` enables use in n8n AI Agent workflows
- **Codex Metadata** — Improved search discoverability with categories, subcategories, and aliases
- **Shared Utilities** — Extracted common functions to `utils.ts`: URL builders, date formatting, error parsing, record type loading

### Improved
- **Error Messages** — Contextual help for HTTP 400, 401, 403, and 404 errors with troubleshooting guidance
- **Input Validation** — Record ID and External ID validation prevents cryptic API errors
- **Pagination Safety** — Maximum iteration limits prevent infinite loops on API anomalies
- **Expanded Fallback Record Types** — 20 common record types available when metadata catalog is unavailable

## [0.2.2] - 2026-03-17

### Fixed
- README repository URLs corrected
- Homepage URL updated to solutionlabtech.com

## [0.2.1] - 2026-03-17

### Fixed
- Minor README corrections

## [0.1.0] - 2026-03-17

### Added
- Initial release
- REST Record operations: Create, Get, Get Many, Update, Upsert, Delete
- SuiteQL query execution with automatic pagination
- Restlet invocation (GET, POST, PUT, DELETE)
- OAuth 2.0 Client Credentials with Certificate (M2M/JWT/PS256) authentication
- Automatic PEM normalization for multiple key formats
- Token caching with automatic refresh
- Dynamic record type dropdown from NetSuite metadata catalog
