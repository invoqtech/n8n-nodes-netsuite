# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-10-17

Package renamed from `n8n-nodes-netsuite-v2` to `@invoqtech/n8n-nodes-netsuite`, now maintained by InvoQ Technologies. Existing workflows must swap their nodes; see "Migrating from n8n-nodes-netsuite-v2" in the README.

### Fixed
- **Trigger time zones** — the polling trigger compared the n8n server's local clock with timestamps NetSuite evaluates in the integration user's time zone. When the two differed it either never fired or re-fired the same records on every poll. The watermark is now produced by NetSuite (`TO_CHAR`) and compared with `TO_DATE` in the same format, so the server clock is no longer used.
- **Trigger duplicates** — records stamped on the watermark second are remembered by ID and not emitted twice.
- **Trigger paging** — trigger queries now `ORDER BY` the watched date and `id`, so offset pages cannot overlap or skip rows.

### Changed
- **Authentication** — the token exchange now runs through n8n's HTTP helper instead of Node's `https` module, and the access token is stored as an expirable credential field that n8n refreshes on a 401 (required for n8n Cloud and verification).
- **Trigger baseline** — on activation the trigger starts from the newest timestamp already in NetSuite; state from 0.x is reset, not replayed. Manual tests look back from that timestamp.
- **Icons** — Oracle NetSuite logo as an SVG icon (light and dark variants).
- **Lint compliance** — node and credential names, option ordering and labels follow the current `@n8n/node-cli` linter (for example "Upsert" is now "Create or Update", Limit defaults to 50, trigger node type is `netSuiteTrigger`).
- **Branding** — author, links, hints and error help now point to InvoQ Technologies (invoqtech.com).

### Added
- GitHub Actions workflows: CI (lint, build, tests) and tag-triggered publishing with npm provenance.
- Unit tests for the trigger watermark logic (`npm test`).

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
