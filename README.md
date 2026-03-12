# n8n-nodes-netsuite-v2

An n8n community node for **NetSuite** using **OAuth 2.0 Client Credentials with Certificate** (Machine-to-Machine / JWT PS256 authentication).

Unlike the standard OAuth 2.0 Authorization Code flow, this authentication method requires **no user interaction** — making it ideal for fully automated server-to-server workflows, scheduled jobs, and background integrations.

## Features

- **M2M Authentication** — OAuth 2.0 Client Credentials with Certificate (JWT signed with PS256). No browser login required.
- **Record Operations** — Create, Get, Get Many, Update, and Delete any NetSuite record type via the SuiteTalk REST API.
- **Dynamic Record Types** — Record type dropdown is populated automatically from your NetSuite metadata catalog.
- **SuiteQL Queries** — Execute SQL-like queries against your NetSuite data with configurable result limits and automatic pagination.
- **Restlet Support** — Call custom SuiteScript Restlet deployments with GET, POST, PUT, and DELETE methods.
- **Automatic Token Management** — Access tokens are cached and refreshed automatically (with a 5-minute safety buffer before expiry).
- **Robust PEM Handling** — Accepts private keys in various formats (escaped newlines, single-line, raw base64) and normalizes them automatically.

## Prerequisites — NetSuite Setup

Before configuring the node in n8n, you need to set up several things in your NetSuite account.

### 1. Create an Integration Record

1. Navigate to **Setup > Integration > Manage Integrations > New**
2. Enter a name for the integration (e.g., "n8n Automation")
3. Under **Authentication**:
   - **Enable** "Client Credentials (Machine to Machine) Grant"
   - You may disable "Authorization Code Grant" if not needed
4. Click **Save**
5. **Copy the Consumer Key** — you will need this for the n8n credential. The Consumer Secret is NOT used for this flow.

### 2. Generate a Certificate Key Pair

Generate an RSA key pair using OpenSSL (4096-bit recommended):

```bash
# Generate private key
openssl genrsa -out private.pem 4096

# Generate public certificate (valid for 365 days)
openssl req -new -x509 -key private.pem -out public.pem -days 365
```

Keep `private.pem` safe — you will paste its contents into the n8n credential form. The `public.pem` file will be uploaded to NetSuite.

### 3. Configure OAuth 2.0 Client Credentials in NetSuite

1. Navigate to **Setup > Integration > OAuth 2.0 Client Credentials (M2M) Setup**
2. Click **Create New**
3. Select:
   - **Entity** — The user/entity that will be associated with API calls
   - **Role** — The role that determines permissions (see below)
   - **Integration** — The integration record you created in Step 1
4. Upload the **public certificate** (`public.pem`) generated in Step 2
5. Click **Save**
6. **Copy the Certificate ID** — this is the `kid` value used in the JWT header

### 4. Configure Role Permissions

The role selected in Step 3 must have appropriate permissions for the APIs you plan to use:

| Resource | Required Permission |
|----------|-------------------|
| Record (SuiteTalk REST) | Setup > REST Web Services |
| SuiteQL | Reports > SuiteAnalytics Workbook |
| Restlet | Setup > SuiteScript |
| All | Setup > Log in using Access Tokens |

For initial testing, you can use the **Administrator** role. For production, create a custom role with only the minimum required permissions.

### 5. Find Your Account ID

1. Navigate to **Setup > Company > Company Information**
2. Your **Account ID** is displayed at the top (e.g., `1234567` or `1234567_SB1` for sandbox)

The node automatically normalizes the Account ID format for API URLs (lowercases and replaces underscores with hyphens).

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

## Credential Configuration

When creating a new **NetSuite Client Credentials (Certificate)** credential in n8n, fill in the following fields:

| Field | Description | Example |
|-------|-------------|---------|
| **Account ID** | Your NetSuite Account ID | `1234567_SB1` |
| **Consumer Key** | From the Integration Record (Step 1) | `fb2325aaa...` |
| **Certificate ID** | From the M2M Setup page (Step 3) | `h9ISeXE7N_2w...` |
| **Certificate Private Key (PEM)** | Full PEM content of your private key | See below |

### Private Key Format

Paste the **entire** contents of your `private.pem` file, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines.

The node handles various formats automatically:
- Standard multi-line PEM
- Single-line with escaped `\n` characters
- Raw base64 without headers
- Keys with `PRIVATE KEY`, `RSA PRIVATE KEY`, or `EC PRIVATE KEY` headers

After filling in all fields, click **Test** to verify the connection. The test calls the NetSuite metadata catalog endpoint.

## Usage

### Record Operations

Select **Resource: Record** to perform CRUD operations on NetSuite records.

**Record Type** — Choose from the dynamically loaded dropdown, or enter a custom record type ID.

#### Create a Record

Select **Operation: Create**, choose the record type, and provide a JSON body in the **Fields** section:

```json
{
  "companyname": "Acme Corp",
  "email": "contact@acme.com",
  "subsidiary": { "id": "1" }
}
```

#### Get a Record

Select **Operation: Get**, choose the record type, and enter the **Record ID** (internal ID).

#### Get Many Records

Select **Operation: Get Many** and choose the record type. Returns a list of records with automatic pagination support.

#### Update a Record

Select **Operation: Update**, choose the record type, enter the **Record ID**, and provide the fields to update:

```json
{
  "email": "new-email@acme.com",
  "phone": "555-0100"
}
```

The update uses HTTP PATCH — only the fields you include will be modified.

#### Delete a Record

Select **Operation: Delete**, choose the record type, and enter the **Record ID**. Returns `{ "success": true, "id": "..." }`.

### SuiteQL Queries

Select **Resource: SuiteQL** and **Operation: Execute**.

Enter your query using SuiteQL syntax (SQL-like, specific to NetSuite):

```sql
SELECT id, companyname, email
FROM customer
WHERE isinactive = 'F'
```

**Options:**
- **Return All** — When enabled, automatically paginates through all results. When disabled, returns up to the specified Limit.
- **Limit** — Maximum number of results to return (default: 1000). Only visible when Return All is disabled.

### Restlet Operations

Select **Resource: Restlet** to call custom SuiteScript Restlet deployments.

| Field | Description |
|-------|-------------|
| **Script ID** | The script ID of the Restlet deployment |
| **Deploy ID** | The deployment ID (usually `1`) |
| **Operation** | HTTP method: GET, POST, PUT, or DELETE |
| **Body (JSON)** | Request body for POST and PUT operations |
| **Additional Parameters** | Extra query string parameters (key-value pairs) |

The Restlet URL is constructed as:
```
https://{accountId}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script={scriptId}&deploy={deployId}
```

## Troubleshooting

### Common Errors

| Error | Likely Cause | Solution |
|-------|-------------|----------|
| **JWT signing failed (PS256)** | Invalid PEM format or wrong key type | Ensure the key is RSA (not EC). Verify proper PEM headers. Run `openssl rsa -check -in private.pem` to validate. |
| **Token exchange failed (HTTP 400)** | Wrong consumer key, certificate ID, or mismatched key pair | Verify consumer key matches the Integration Record. Verify certificate ID from M2M Setup. Ensure the private key matches the uploaded public certificate. |
| **DNS resolution failure** | Incorrect Account ID | Check Setup > Company > Company Information. Format should be `1234567` or `1234567_SB1`. |
| **HTTP 403 on API calls** | Insufficient role permissions | The role mapped in M2M Setup needs REST Web Services, SuiteScript, or SuiteAnalytics Workbook permissions. |
| **Token response missing access_token** | M2M not enabled on integration | Verify the Integration Record has "Client Credentials (M2M) Grant" enabled. Verify the M2M Setup mapping is active. |
| **"Bad request - please check your parameters"** | Token not being applied to requests | This can occur if the credential test flow doesn't obtain a token properly. Rebuild and reinstall the node. |

### Debugging Tips

1. **Check the credential test first** — Click "Test" in the n8n credential form. The error message will indicate which step failed (input validation, JWT signing, token exchange, or API call).

2. **Verify the key pair matches** — The private key you paste into n8n must correspond to the public certificate uploaded to NetSuite. Generate both from the same key pair.

3. **Check the M2M Setup status** — In NetSuite, go to Setup > Integration > OAuth 2.0 Client Credentials (M2M) Setup and verify your mapping is active.

4. **Sandbox accounts** — If using a sandbox, your Account ID includes `_SB1` (or similar suffix). The node handles this automatically.

## How Authentication Works

For those interested in the technical details:

1. The node builds a **JWT** with header (`alg: PS256`, `kid: <certificate_id>`) and payload (`iss: <consumer_key>`, `scope: ['restlets', 'rest_webservices']`, `iat`, `exp`, `aud: <token_url>`)
2. The JWT is signed with **PS256** (RSASSA-PSS with SHA-256) using the certificate private key
3. The signed JWT is exchanged for an **access token** via POST to `https://<account-id>.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`
4. The access token is cached and reused until 5 minutes before expiry
5. All API requests include the token as `Authorization: Bearer <token>`

## License

MIT
