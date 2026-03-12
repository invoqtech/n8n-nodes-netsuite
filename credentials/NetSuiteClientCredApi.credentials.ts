import * as crypto from 'crypto';
import * as https from 'https';
import type {
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IDataObject,
	IHttpRequestHelper,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64urlEncode(str: string): string {
	return Buffer.from(str)
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

function base64urlEncodeBuffer(buf: Buffer): string {
	return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function normalizeAccountId(accountId: string): string {
	return accountId.toLowerCase().replace(/_/g, '-');
}

/**
 * Normalize PEM private key into a format that Node's crypto module accepts.
 *
 * Handles every variant we've seen from n8n's form storage:
 *  - Literal \\n / \\r\\n sequences instead of real newlines
 *  - Entire key on one line (spaces instead of newlines)
 *  - Raw base64 without BEGIN/END headers
 *  - Correct PEM (passed through)
 *
 * Strategy: always extract the raw base64, then rebuild the PEM from scratch.
 */
function normalizePem(raw: string): string {
	// Step 1 — resolve escaped newlines to real ones
	let key = raw
		.replace(/\\r\\n/g, '\n')
		.replace(/\\n/g, '\n')
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.trim();

	// Step 2 — detect PEM type header (PRIVATE KEY, RSA PRIVATE KEY, EC PRIVATE KEY, etc.)
	const headerMatch = key.match(/-----BEGIN ([A-Z ]+)-----/);
	const pemType = headerMatch ? headerMatch[1] : 'PRIVATE KEY';

	// Step 3 — strip PEM headers/footers to get the raw base64
	key = key
		.replace(/-----BEGIN [A-Z ]+-----/g, '')
		.replace(/-----END [A-Z ]+-----/g, '');

	// Step 4 — remove all whitespace from the base64 content
	const base64Content = key.replace(/\s+/g, '');

	// Step 5 — rebuild with proper 64-char lines
	const lines: string[] = [];
	for (let i = 0; i < base64Content.length; i += 64) {
		lines.push(base64Content.substring(i, i + 64));
	}

	return `-----BEGIN ${pemType}-----\n${lines.join('\n')}\n-----END ${pemType}-----`;
}

// ---------------------------------------------------------------------------
// Module-level token cache (keyed by accountId)
// ---------------------------------------------------------------------------
const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

/**
 * Standalone function that performs the full JWT signing + token exchange.
 * Uses native `https` module to avoid n8n httpRequest encoding issues.
 * Returns the raw access_token string.
 */
async function exchangeForAccessToken(credentials: ICredentialDataDecryptedObject): Promise<string> {
	// --- Validate inputs ---
	const rawAccountId = credentials.accountId as string;
	const consumerKey = credentials.consumerKey as string;
	const certificateId = credentials.certificateId as string;
	const rawPrivateKey = credentials.privateKey as string;

	if (!rawAccountId || !rawAccountId.trim()) {
		throw new Error('NetSuite credential error: Account ID is empty.');
	}
	if (!consumerKey || !consumerKey.trim()) {
		throw new Error('NetSuite credential error: Consumer Key is empty.');
	}
	if (!certificateId || !certificateId.trim()) {
		throw new Error('NetSuite credential error: Certificate ID is empty.');
	}
	if (!rawPrivateKey || !rawPrivateKey.trim()) {
		throw new Error('NetSuite credential error: Certificate Private Key is empty.');
	}

	const accountId = normalizeAccountId(rawAccountId);
	const privateKey = normalizePem(rawPrivateKey);
	const cacheKey = `${accountId}:${consumerKey}`;

	// Check module-level cache
	const cached = tokenCache.get(cacheKey);
	if (cached) {
		const now = Math.floor(Date.now() / 1000);
		if (now < cached.expiresAt - 300) {
			return cached.accessToken;
		}
	}

	const tokenUrl = `https://${accountId}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;
	const now = Math.floor(Date.now() / 1000);

	// --- Build JWT ---
	const header = { alg: 'PS256', typ: 'JWT', kid: certificateId };
	const payload = {
		iss: consumerKey,
		scope: ['restlets', 'rest_webservices'],
		iat: now,
		exp: now + 3600,
		aud: tokenUrl,
	};

	const encodedHeader = base64urlEncode(JSON.stringify(header));
	const encodedPayload = base64urlEncode(JSON.stringify(payload));
	const signingInput = `${encodedHeader}.${encodedPayload}`;

	// --- Sign JWT ---
	let jwt: string;
	try {
		const signature = crypto.sign('sha256', Buffer.from(signingInput), {
			key: privateKey,
			padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
			saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
		});
		jwt = `${signingInput}.${base64urlEncodeBuffer(signature)}`;
	} catch (signError) {
		const keyPreview = privateKey.substring(0, 40);
		throw new Error(
			`JWT signing failed (PS256). Check that Certificate Private Key is valid PEM format. ` +
				`Key starts with: "${keyPreview}...". ` +
				`Detail: ${(signError as Error).message}`,
		);
	}

	// --- Exchange JWT for access token via native https ---
	const tokenBody = new URLSearchParams({
		grant_type: 'client_credentials',
		client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
		client_assertion: jwt,
	}).toString();

	const tokenResponseBody = await new Promise<string>((resolve, reject) => {
		const urlObj = new URL(tokenUrl);
		const req = https.request(
			{
				hostname: urlObj.hostname,
				path: urlObj.pathname,
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'Content-Length': Buffer.byteLength(tokenBody),
				},
			},
			(res) => {
				let data = '';
				res.on('data', (chunk: Buffer) => {
					data += chunk.toString();
				});
				res.on('end', () => {
					if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
						resolve(data);
					} else {
						reject(
							new Error(
								`Token exchange failed (HTTP ${res.statusCode}). ` +
									`URL: ${tokenUrl} | Response: ${data}`,
							),
						);
					}
				});
			},
		);
		req.on('error', (err) => {
			reject(
				new Error(`Token exchange network error. URL: ${tokenUrl} | Detail: ${err.message}`),
			);
		});
		req.write(tokenBody);
		req.end();
	});

	// --- Parse and validate response ---
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let parsed: any;
	try {
		parsed = JSON.parse(tokenResponseBody);
	} catch {
		throw new Error(
			`Token response is not valid JSON. Body: ${tokenResponseBody.substring(0, 200)}`,
		);
	}

	if (!parsed || !parsed.access_token) {
		throw new Error(
			`Token response missing access_token. Full response: ${JSON.stringify(parsed)}`,
		);
	}

	const accessToken = parsed.access_token as string;
	const expiresIn = Number(parsed.expires_in) || 3600;

	// Cache the token
	tokenCache.set(cacheKey, { accessToken, expiresAt: now + expiresIn });

	return accessToken;
}

// ---------------------------------------------------------------------------
// Credential class
// ---------------------------------------------------------------------------

export class NetSuiteClientCredApi implements ICredentialType {
	name = 'netSuiteClientCredApi';
	displayName = 'NetSuite Client Credentials (Certificate)';
	documentationUrl =
		'https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_162515992498.html';

	properties: INodeProperties[] = [
		{
			displayName: 'Account ID',
			name: 'accountId',
			type: 'string',
			default: '',
			placeholder: '1234567_SB1',
			description:
				'Your NetSuite Account ID (e.g. 1234567 or 1234567_SB1 for sandbox). Found under Setup > Company > Company Information.',
			required: true,
		},
		{
			displayName: 'Consumer Key',
			name: 'consumerKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'The Consumer Key from the integration record in NetSuite. Generated when creating an integration record.',
			required: true,
		},
		{
			displayName: 'Certificate ID',
			name: 'certificateId',
			type: 'string',
			default: '',
			description:
				'The Certificate ID (kid) from Setup > Integration > OAuth 2.0 Client Credentials (M2M) Setup in NetSuite.',
			required: true,
		},
		{
			displayName: 'Certificate Private Key (PEM)',
			name: 'privateKey',
			type: 'string',
			typeOptions: { password: true, rows: 5 },
			default: '',
			placeholder: '-----BEGIN PRIVATE KEY-----\n...your key here...\n-----END PRIVATE KEY-----',
			description:
				'The private key in PEM format used to sign the JWT assertion. This is the private key of the certificate uploaded to NetSuite. Paste the entire PEM content including BEGIN/END lines.',
			required: true,
		},
	];

	// -----------------------------------------------------------------------
	// preAuthentication — runs before each httpRequestWithAuthentication call
	// during workflow execution. Returns data merged into credentials.
	// -----------------------------------------------------------------------
	async preAuthentication(
		this: IHttpRequestHelper,
		credentials: ICredentialDataDecryptedObject,
	): Promise<IDataObject> {
		const accessToken = await exchangeForAccessToken(credentials);
		return {
			access_token: accessToken,
			normalizedAccountId: normalizeAccountId(credentials.accountId as string),
		};
	}

	// -----------------------------------------------------------------------
	// authenticate — function-based hook called for EVERY request, including
	// credential tests. If preAuthentication already set access_token, we
	// reuse it; otherwise we obtain a fresh token (handles the case where
	// n8n skips preAuthentication during credential testing).
	// -----------------------------------------------------------------------
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	authenticate: any = async (
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> => {
		// Try to use access_token set by preAuthentication; fall back to direct exchange
		let accessToken = credentials.access_token as string | undefined;
		if (!accessToken) {
			accessToken = await exchangeForAccessToken(credentials);
		}

		if (!requestOptions.headers) {
			requestOptions.headers = {};
		}
		(requestOptions.headers as Record<string, string>).Authorization = `Bearer ${accessToken}`;
		return requestOptions;
	};

	// -----------------------------------------------------------------------
	// test — declarative test request.  Uses split/join instead of regex
	// (safer inside n8n expression engine).
	// -----------------------------------------------------------------------
	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'=https://{{$credentials.accountId.toLowerCase().split("_").join("-")}}.suitetalk.api.netsuite.com',
			url: '/services/rest/record/v1/metadata-catalog',
			method: 'GET',
			headers: {
				Prefer: 'transient',
			},
		},
	};
}
