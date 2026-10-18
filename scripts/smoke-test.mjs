// Live smoke test against a NetSuite sandbox, without n8n.
// Exercises the built credential (JWT PS256 token exchange), a Record GET,
// and the polling trigger's baseline + watermark queries.
//
//   npm run build
//   NS_ACCOUNT_ID=1234567_SB1 NS_CONSUMER_KEY=... NS_CERT_ID=... \
//   NS_PRIVATE_KEY_FILE=./private.pem node scripts/smoke-test.mjs [recordType]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NetSuiteInvoqApi } = require('../dist/credentials/NetSuiteInvoqApi.credentials.js');
const u = require('../dist/nodes/NetSuite/utils.js');

const env = (k) => {
	const v = process.env[k];
	if (!v) {
		console.error(`Missing ${k}`);
		process.exit(2);
	}
	return v;
};
const credentials = {
	accountId: env('NS_ACCOUNT_ID'),
	consumerKey: env('NS_CONSUMER_KEY'),
	certificateId: env('NS_CERT_ID'),
	privateKey: readFileSync(env('NS_PRIVATE_KEY_FILE'), 'utf8'),
};
const recordType = process.argv[2] || 'customer';
const base = u.buildSuiteTalkBaseUrl(credentials.accountId);

// Minimal stand-in for n8n's helpers.httpRequest: string bodies are sent as-is,
// JSON responses are parsed, non-2xx responses throw with error.response.
async function httpRequest(opts) {
	const url = new URL(opts.url);
	for (const [k, v] of Object.entries(opts.qs || {})) url.searchParams.set(k, String(v));
	const body =
		opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
	const res = await fetch(url, { method: opts.method || 'GET', headers: opts.headers, body });
	const text = await res.text();
	let data = text;
	try {
		data = JSON.parse(text);
	} catch {}
	if (!res.ok) {
		const err = new Error(`HTTP ${res.status}`);
		err.response = { status: res.status, data };
		throw err;
	}
	return data;
}

const cred = new NetSuiteInvoqApi();
const step = async (name, fn) => {
	process.stdout.write(`- ${name} ... `);
	try {
		const out = await fn();
		console.log('OK', out ?? '');
		return out;
	} catch (e) {
		console.log('FAIL');
		console.error('  ', e.response ? JSON.stringify(e.response.data).slice(0, 600) : e.message);
		process.exit(1);
	}
};

const { accessToken } = await step('1. Token exchange (certificate JWT)', async () => {
	const r = await cred.preAuthentication.call({ helpers: { httpRequest } }, credentials);
	if (!r.accessToken) throw new Error('no accessToken returned');
	return r;
}).then((r) => r);

const authed = async (opts) => {
	const signed = await cred.authenticate({ ...credentials, accessToken }, { ...opts, headers: { ...(opts.headers || {}) } });
	return httpRequest(signed);
};
const suiteql = (q, limit = 5, offset = 0) =>
	authed({
		method: 'POST',
		url: `${base}/query/v1/suiteql`,
		qs: { limit, offset },
		body: { q },
		headers: { 'Content-Type': 'application/json', Prefer: 'transient' },
	});

await step('2. Metadata catalog (credential test endpoint)', async () => {
	await authed({ method: 'GET', url: `${base}/record/v1/metadata-catalog`, headers: { Prefer: 'transient' } });
});

const sample = await step(`3. SuiteQL: newest ${recordType} id`, async () => {
	const r = await suiteql(`SELECT id FROM ${recordType} ORDER BY lastmodifieddate DESC`, 1);
	return r.items?.[0]?.id ? `id ${r.items[0].id}` : 'no records';
});

if (sample && sample !== 'no records') {
	await step(`4. Record GET ${recordType}/${sample.slice(3)}`, async () => {
		const r = await authed({ method: 'GET', url: `${base}/record/v1/${recordType}/${sample.slice(3)}` });
		return `fields returned: ${Object.keys(r).length}`;
	});
}

const baseline = await step('5. Trigger baseline query', async () => {
	const r = await suiteql(u.buildBaselineQuery(recordType, 'lastmodifieddate'), 1);
	return r.items?.[0]?.[u.WM_COLUMN] || u.EPOCH_WATERMARK;
});

await step('6. Trigger query (SELECT t.*, ORDER BY) over the last 24h', async () => {
	const watermark = u.shiftTimestamp(baseline, -24);
	for (const fields of ['*', 'id']) {
		const q = u.buildTriggerQuery({
			recordType,
			event: 'createdOrUpdated',
			fields,
			dateCreatedField: 'datecreated',
			dateModifiedField: 'lastmodifieddate',
			additionalFilters: '',
			watermark,
		});
		const r = await suiteql(q, 5);
		const { items, next } = u.applyWatermark(r.items || [], { watermark, boundaryIds: [] });
		console.log(`\n    fields=${fields}: ${items.length} row(s), next watermark ${next.watermark}`);
		const again = u.applyWatermark(r.items || [], next);
		if (again.items.some((i) => next.boundaryIds.includes(String(i.id))))
			throw new Error('boundary de-duplication failed');
	}
	return `watermark from ${watermark}`;
});

console.log('\nAll checks passed.');
