# n8n-nodes-netsuite-v2

[![npm version](https://img.shields.io/npm/v/n8n-nodes-netsuite-v2.svg)](https://www.npmjs.com/package/n8n-nodes-netsuite-v2)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![n8n community node](https://img.shields.io/badge/n8n-community%20node-ff6d5a.svg)](https://docs.n8n.io/integrations/community-nodes/)

A production-grade n8n community node for **Oracle NetSuite**, built by **[SolutionLab](https://solutionlabtech.com)** ([Avishai Asaf](https://www.linkedin.com/in/avishaiasaf/)). Connects to the NetSuite REST API using **OAuth 2.0 Client Credentials with Certificate** (Machine-to-Machine / JWT PS256) - the most secure, fully automated authentication method available for server-to-server integrations.

**3 resources. 10 operations. Polling triggers. Zero user interaction required for authentication.**

---

## Why This Node?

Standard NetSuite integrations in n8n rely on OAuth 2.0 Authorization Code flow, which requires a browser-based login, manual token refresh, and session management. This creates fragile automations that break when tokens expire or when running in headless environments.

This node was built by SolutionLab to solve three specific production bottlenecks:

### Fully Automated M2M Authentication

OAuth 2.0 Client Credentials with Certificate eliminates all user interaction. The node constructs a JWT, signs it with PS256 (RSASSA-PSS + SHA-256), and exchanges it for an access token - entirely in the background. Tokens are cached per credential and automatically refreshed with a 5-minute safety buffer before expiry. No browser sessions. No token expiry surprises. No manual intervention.

### Robust Certificate Handling

Real-world NetSuite certificate integrations frequently fail on PEM format edge cases - especially when private keys are pasted through web UIs, environment variables, or secret managers. This node normalizes every variant automatically:

- Standard multi-line PEM with proper 64-character line breaks
- Single-line keys with escaped `\n` characters
- Raw base64 content without BEGIN/END headers
- Keys with `PRIVATE KEY`, `RSA PRIVATE KEY`, or `EC PRIVATE KEY` headers

### Enterprise API Coverage with Automatic Pagination

SuiteQL queries and REST Record listings automatically paginate through all results when "Return All" is enabled. NetSuite's structured error responses (`o:errorDetails`, `o:errorCode`) are parsed and surfaced as readable messages instead of raw HTTP errors.

---

## Enterprise Features

### REST Record Operations

Full CRUD operations on any NetSuite record type via the SuiteTalk REST API.

| Operation | Method | Description |
|-----------|--------|-------------|
| **Create** | POST | Create a record with a JSON body |
| **Get** | GET | Retrieve a single record by internal ID |
| **Get Many** | GET | List records with filtering, field selection, and sub-resource expansion |
| **Update** | PATCH | Partial update - only the fields you include are modified |
| **Delete** | DELETE | Remove a record by internal ID |

**Dynamic Record Types** - The record type dropdown is populated automatically from NetSuite's metadata catalog (`/services/rest/record/v1/metadata-catalog`). If the catalog is unavailable, the node falls back to nine common record types: Customer, Employee, Invoice, Item, Journal Entry, Purchase Order, Sales Order, Vendor, and Vendor Bill.

**Get Many Pagination** - Enable "Return All" to automatically follow NetSuite's `rel:next` pagination links until all records are retrieved. When disabled, a single page of results is returned up to the configured limit.

**Additional Options** (available on Get and Get Many):

| Option | Type | Description |
|--------|------|-------------|
| **Fields** | String | Comma-separated list of field names to return (reduces payload size) |
| **Expand Sub-Resources** | Boolean | Include sublists and line items in the response |
| **Query Filter** | String | Filter expression to narrow results (Get Many only) |

### SuiteQL

Execute SQL-like queries against your NetSuite data using Oracle's SuiteQL syntax.

- **Automatic Pagination** - When "Return All" is enabled, the node paginates through results using NetSuite's `hasMore` flag and offset-based pagination
- **Configurable Limit** - When "Return All" is disabled, returns up to the specified limit (default: 1000)
- **Transient Preferences** - Requests include the `Prefer: transient` header for optimized response handling

### Restlet Operations

Call custom SuiteScript Restlet deployments with full HTTP method support.

| Method | Body | Use Case |
|--------|------|----------|
| **GET** | No | Retrieve data from a custom endpoint |
| **POST** | JSON | Submit data or trigger server-side logic |
| **PUT** | JSON | Update resources via a custom endpoint |
| **DELETE** | No | Remove resources via a custom endpoint |

Each request requires a **Script ID** and **Deploy ID**. Additional query string parameters can be passed as key-value pairs. The Restlet URL is constructed as:

```
https://{accountId}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script={scriptId}&deploy={deployId}
```

### Platform Capabilities

- **Token Caching** - Access tokens are cached per `accountId:consumerKey` pair in a module-level store. Tokens are reused across workflow executions within the same n8n process and refreshed automatically 5 minutes before expiry.
- **PEM Normalization** - Handles four input variants (multi-line, escaped newlines, single-line, raw base64) and rebuilds the key with proper 64-character line formatting.
- **Structured Error Parsing** - NetSuite REST API error responses are parsed to extract `o:errorDetails` and `o:errorCode` fields, providing specific error codes and messages instead of generic HTTP status text.
- **Native Token Exchange** - The JWT-to-token exchange uses Node.js native `https` instead of n8n's HTTP request helper, avoiding URL encoding issues with the `client_assertion` parameter.

### Polling Triggers

The **NetSuite Trigger** node monitors your NetSuite data for changes and starts workflows automatically. It uses SuiteQL to poll for records that have been created or modified since the last check.

| Event | Behavior |
|-------|----------|
| **Record Created** | Triggers when new records are created (uses `datecreated` field) |
| **Record Updated** | Triggers when existing records are modified, excluding newly created records |
| **Record Created or Updated** | Triggers on any change (uses `lastmodifieddate` field) |

**Key capabilities:**
- **Dynamic record type dropdown** - Same metadata catalog integration as the main node
- **Configurable date fields** - Override `datecreated` and `lastmodifieddate` for custom records that use different field names
- **Additional filters** - Narrow polling scope with SuiteQL WHERE clause fragments (e.g., `AND subsidiary = 1`)
- **Field selection** - Return only the fields you need instead of `SELECT *`
- **Automatic pagination** - Handles large result sets across multiple pages
- **Structured error handling** - NetSuite error codes are parsed and surfaced clearly

> **Polling interval:** Configured in the n8n workflow settings (default: every minute). The trigger establishes a baseline on first activation and only fires for records changed after that point.

---

## Installation

### Community Nodes (Recommended)

1. In n8n, go to **Settings > Community Nodes**
2. Enter `n8n-nodes-netsuite-v2`
3. Click **Install**
4. Restart n8n if prompted

### Manual Installation

```bash
cd ~/.n8n/custom
npm install n8n-nodes-netsuite-v2
```

Then restart n8n.

> **Compatibility:** Requires n8n with `n8n-workflow` >= 2.12.0.

---

## NetSuite Setup - Prerequisites

Before configuring the node in n8n, complete the following steps in your NetSuite account. Administrator access is required for initial setup.

### Step 1: Create an Integration Record

Navigate to **Setup > Integration > Manage Integrations > New**.

| Setting | Value |
|---------|-------|
| Name | e.g., "n8n Automation" |
| Client Credentials (M2M) Grant | **Enabled** |
| Authorization Code Grant | Disable (not used) |
| Token-Based Authentication | Not required |

Click **Save**, then **copy the Consumer Key**. The Consumer Secret is not used in the M2M flow.

### Step 2: Generate a Certificate Key Pair

Generate an RSA key pair using OpenSSL (4096-bit recommended):

```bash
# Generate private key
openssl genrsa -out private.pem 4096

# Generate public certificate (valid for 365 days)
openssl req -new -x509 -key private.pem -out public.pem -days 365
```

> **Security:** Keep `private.pem` secure. Its contents will be pasted into the n8n credential form. Never commit private keys to version control.

### Step 3: Configure OAuth 2.0 Client Credentials Mapping

Navigate to **Setup > Integration > OAuth 2.0 Client Credentials (M2M) Setup** and click **Create New**.

| Field | Description |
|-------|-------------|
| **Entity** | The user or employee associated with API calls |
| **Role** | The role that determines API permissions (see Step 4) |
| **Integration** | The integration record created in Step 1 |

Upload the **public certificate** (`public.pem`) from Step 2, then click **Save**.

**Copy the Certificate ID** - this is the `kid` value used in the JWT header for token signing.

### Step 4: Configure Role Permissions

The role selected in Step 3 must have the following permissions based on which resources you plan to use:

| Resource | Required Permission | Navigation Path |
|----------|---------------------|-----------------|
| REST Records (SuiteTalk) | REST Web Services | Setup > REST Web Services |
| SuiteQL | SuiteAnalytics Workbook | Reports > SuiteAnalytics Workbook |
| Restlets | SuiteScript | Setup > SuiteScript |
| All Resources | Log in using Access Tokens | Setup > Log in using Access Tokens |

> **Tip:** For initial testing, use the **Administrator** role. For production, create a custom role with only the minimum required permissions.

### Step 5: Find Your Account ID

Navigate to **Setup > Company > Company Information**. Your Account ID is displayed at the top of the page.

- Production accounts: `1234567`
- Sandbox accounts: `1234567_SB1`

The node automatically normalizes the Account ID for API URLs (converts to lowercase and replaces underscores with hyphens).

---

## Credential Configuration

When creating a new **NetSuite Client Credentials (Certificate)** credential in n8n, fill in the following fields:

| Field | Description | Where to Find |
|-------|-------------|---------------|
| **Account ID** | Your NetSuite Account ID | Setup > Company > Company Information |
| **Consumer Key** | Integration consumer key | Integration Record (Step 1) |
| **Certificate ID** | Certificate ID (JWT `kid` claim) | M2M Setup page (Step 3) |
| **Certificate Private Key (PEM)** | Full contents of your private key file | `private.pem` from Step 2 |

### Private Key Format

Paste the **entire** contents of your `private.pem` file, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines.

The node handles multiple formats automatically:

- Standard multi-line PEM
- Single-line with escaped `\n` characters
- Raw base64 without headers
- Keys with `PRIVATE KEY`, `RSA PRIVATE KEY`, or `EC PRIVATE KEY` headers

### Testing the Connection

Click **Test** in the n8n credential form to verify the connection. The test performs a full authentication cycle (JWT creation, token exchange) and calls `GET /services/rest/record/v1/metadata-catalog` with the `Prefer: transient` header. If the test passes, all four credential fields are valid and the certificate is correctly mapped in NetSuite.

---

## Usage

### Record Operations

Select **Resource: Record** to perform CRUD operations on NetSuite records.

#### Create a Record

Select **Operation: Create**, choose the record type, and provide a JSON body:

```json
{
  "companyname": "Acme Corp",
  "email": "contact@acme.com",
  "subsidiary": { "id": "1" }
}
```

#### Get a Record

Select **Operation: Get**, choose the record type, and enter the **Record ID** (internal ID).

Use **Additional Options** to control the response:
- **Fields**: `companyname,email,phone` - return only specific fields
- **Expand Sub-Resources**: include sublists and line items in the response

#### Get Many Records

Select **Operation: Get Many** and choose the record type.

- Enable **Return All** to automatically paginate through all matching records
- Use the **Query Filter** additional option to narrow results (e.g., `email IS NOT NULL`)
- Set a **Limit** when Return All is disabled to control the page size

#### Update a Record

Select **Operation: Update**, choose the record type, enter the **Record ID**, and provide the fields to update:

```json
{
  "email": "new-email@acme.com",
  "phone": "555-0100"
}
```

The update uses HTTP PATCH - only the fields you include will be modified.

#### Delete a Record

Select **Operation: Delete**, choose the record type, and enter the **Record ID**.

### SuiteQL Queries

Select **Resource: SuiteQL** and **Operation: Execute**.

Enter your query using SuiteQL syntax:

```sql
SELECT id, companyname, email
FROM customer
WHERE isinactive = 'F'
```

SuiteQL supports JOIN operations for cross-table queries:

```sql
SELECT t.tranid, t.trandate, c.companyname
FROM transaction t
JOIN customer c ON t.entity = c.id
WHERE t.type = 'SalesOrd'
```

**Options:**
- **Return All** - When enabled, automatically paginates through all results using offset-based pagination. When disabled, returns up to the specified Limit.
- **Limit** - Maximum number of results per page (default: 1000). Only visible when Return All is disabled.

### Restlet Operations

Select **Resource: Restlet** to call custom SuiteScript Restlet deployments.

| Field | Description |
|-------|-------------|
| **Script ID** | The numeric script ID of the Restlet deployment |
| **Deploy ID** | The deployment ID (default: `1`) |
| **Operation** | HTTP method: GET, POST, PUT, or DELETE |
| **Body (JSON)** | Request body for POST and PUT operations |
| **Additional Parameters** | Extra query string parameters (key-value pairs) |

Example POST body for a custom Restlet:

```json
{
  "action": "createRecord",
  "recordType": "customrecord_project",
  "values": {
    "name": "New Project",
    "custrecord_status": "1"
  }
}
```

### Trigger Setup

Add a **NetSuite Trigger** node as the first node in your workflow.

1. Select the **Record Type** to monitor (e.g., Customer, Sales Order, Invoice)
2. Choose the **Event** type: Created, Updated, or Created or Updated
3. Optionally specify **Return Fields** (e.g., `id, companyname, email`) to reduce payload size
4. Optionally add **Additional Filters** to narrow the scope (e.g., `AND subsidiary = 1`)

The trigger polls NetSuite at the interval configured in your workflow settings. On first activation, it records the current timestamp as a baseline - only records changed after activation will trigger the workflow.

---

## How Authentication Works

This section details the OAuth 2.0 Client Credentials with Certificate flow as implemented in this node.

### JWT Construction

The node builds a JSON Web Token with the following structure:

**Header:**

```json
{
  "alg": "PS256",
  "typ": "JWT",
  "kid": "<certificateId>"
}
```

**Payload:**

```json
{
  "iss": "<consumerKey>",
  "scope": ["restlets", "rest_webservices"],
  "iat": 1710000000,
  "exp": 1710003600,
  "aud": "https://<accountId>.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token"
}
```

| Claim | Description |
|-------|-------------|
| `iss` | The Consumer Key from the Integration Record |
| `scope` | Fixed scopes: `restlets` and `rest_webservices` |
| `iat` | Issued-at timestamp (current Unix time in seconds) |
| `exp` | Expiration timestamp (issued-at + 3600 seconds) |
| `aud` | The token endpoint URL (also the audience) |
| `kid` | The Certificate ID from the M2M Setup page |

### JWT Signing

The JWT is signed using **PS256** (RSASSA-PSS with SHA-256):

- Algorithm: `crypto.sign('sha256', signingInput, { key, padding: RSA_PKCS1_PSS_PADDING, saltLength: RSA_PSS_SALTLEN_DIGEST })`
- The signing input is `base64url(header).base64url(payload)`
- The signature is base64url-encoded and appended: `header.payload.signature`

### Token Exchange

The signed JWT is exchanged for an access token via HTTP POST:

```
POST https://<accountId>.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
&client_assertion=<signedJwt>
```

The token exchange uses Node.js native `https.request` instead of n8n's HTTP helper to avoid URL encoding issues with the `client_assertion` parameter.

### Token Caching

```
Cache Key:   {accountId}:{consumerKey}
Storage:     Module-level Map (persists across workflow executions within the same n8n process)
Refresh:     300 seconds (5 minutes) before token expiry
```

When a cached token is still valid (more than 5 minutes until expiry), it is reused without making a new token exchange request. This minimizes API calls to the NetSuite token endpoint.

### Authentication Hooks

Two hooks ensure the Bearer token is attached to every outgoing request:

1. **Pre-Authentication** - Runs before each `httpRequestWithAuthentication` call, exchanges credentials for a token, and stores it for the authenticate hook
2. **Authenticate** - Injects the `Authorization: Bearer <token>` header into the request. Falls back to a direct token exchange if pre-authentication was skipped (e.g., during credential testing)

---

## Troubleshooting

### Error Reference

| Error Message | Cause | Solution |
|---------------|-------|----------|
| **NetSuite credential error: Account ID is empty** | Account ID field not filled in | Enter your Account ID from Setup > Company > Company Information |
| **NetSuite credential error: Consumer Key is empty** | Consumer Key field not filled in | Enter the Consumer Key from the Integration Record |
| **NetSuite credential error: Certificate ID is empty** | Certificate ID field not filled in | Enter the Certificate ID from the M2M Setup page |
| **NetSuite credential error: Certificate Private Key is empty** | Private Key field not filled in | Paste the full contents of your `private.pem` file |
| **JWT signing failed (PS256)** | Invalid PEM format or unsupported key type | Verify the key is RSA. Run `openssl rsa -check -in private.pem` to validate. Ensure the full PEM content including BEGIN/END lines is pasted. |
| **Token exchange failed (HTTP 400)** | Mismatched credentials or key pair | Verify the Consumer Key matches the Integration Record. Verify the Certificate ID from M2M Setup. Ensure the private key corresponds to the uploaded public certificate. |
| **Token exchange failed (HTTP 401)** | M2M grant not enabled or mapping inactive | Verify the Integration Record has "Client Credentials (M2M) Grant" enabled. Verify the M2M Setup mapping is active. |
| **Token exchange network error** | DNS resolution failure or network issue | Check the Account ID format. Verify network connectivity to `*.suitetalk.api.netsuite.com`. |
| **Token response is not valid JSON** | Unexpected response from token endpoint | The NetSuite token endpoint may be temporarily unavailable. Retry after a few minutes. |
| **Token response missing access_token** | Token endpoint returned an unexpected payload | Verify the M2M Setup is complete and active. Check that the Integration Record is not disabled. |
| **HTTP 403 on API calls** | Insufficient role permissions | Add the required permissions to the role mapped in M2M Setup (see Step 4 in Prerequisites). |

### Debugging Steps

1. **Start with the credential test** - Click "Test" in the n8n credential form. The error message indicates exactly which step failed: input validation, JWT signing, token exchange, or the API call itself.

2. **Verify the key pair matches** - The private key pasted into n8n must correspond to the public certificate uploaded to NetSuite. Both must be generated from the same OpenSSL key pair.

3. **Check the M2M Setup status** - Navigate to Setup > Integration > OAuth 2.0 Client Credentials (M2M) Setup in NetSuite and confirm your mapping shows as active.

4. **Sandbox accounts** - If using a sandbox, your Account ID includes `_SB1` (or similar suffix). The node normalizes this automatically - no manual formatting required.

---

## Professional Services & Support

This node is developed and maintained by **SolutionLab**, a team that specializes in NetSuite integrations, SuiteScript development, and n8n workflow automation.

If your requirements go beyond what this node provides out of the box, SolutionLab offers:

- **Custom NetSuite Integration Development** - Tailored integrations between NetSuite and third-party systems, including complex data mappings and business logic
- **SuiteScript & Restlet Development** - Server-side and client-side SuiteScript development for custom NetSuite functionality, including Restlet endpoints for external system access
- **n8n Workflow Design & Deployment** - End-to-end workflow architecture, from initial design through production deployment and monitoring
- **Real-Time NetSuite Triggers** - For sub-second event-driven workflows, SolutionLab can deploy custom User Event Scripts in your NetSuite account that push events to n8n webhooks in real time. This eliminates polling latency for time-critical integrations.
- **Production Support & Troubleshooting** - Ongoing support for NetSuite integrations, including performance optimization and issue resolution

**Contact:** [avishai@solutionlabtech.com](mailto:avishai@solutionlabtech.com) | [LinkedIn](https://www.linkedin.com/in/avishaiasaf/) | [solutionlabtech.com](https://solutionlabtech.com)

---

## Contributing

```bash
# Clone the repository
git clone https://github.com/avishaiasaf/n8n-netsuite-node-v2.git
cd n8n-nodes-netsuite-v2

# Install dependencies
npm install

# Build
npm run build

# Lint
npm run lint
```

Submit issues and pull requests via [GitHub](https://github.com/avishaiasaf/n8n-netsuite-node-v2).

---

## License

MIT
