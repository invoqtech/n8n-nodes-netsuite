const test = require('node:test');
const assert = require('node:assert/strict');
const { searchRecordTypes, recordTypeProperty } = require('../dist/nodes/NetSuite/utils.js');

const makeContext = (accountId, impl) => {
	const ctx = {
		calls: 0,
		logger: { warn() {} },
		getCredentials: async () => ({ accountId }),
		helpers: {
			httpRequestWithAuthentication: async () => {
				ctx.calls++;
				return impl();
			},
		},
	};
	return ctx;
};

test('catalog is fetched once per account, then served from cache and filtered', async () => {
	const ctx = makeContext('111_SB1', () => ({ items: [{ name: 'salesOrder' }, { name: 'customer' }, { name: 'customer' }] }));
	const [a, b] = await Promise.all([searchRecordTypes.call(ctx), searchRecordTypes.call(ctx)]);
	assert.equal(ctx.calls, 1, 'concurrent callers share one request');
	assert.deepEqual(a.results.map((r) => r.value), ['customer', 'salesOrder']);
	assert.deepEqual(b, a);
	const filtered = await searchRecordTypes.call(ctx, 'SALES');
	assert.equal(ctx.calls, 1, 'second call hits the cache');
	assert.deepEqual(filtered.results.map((r) => r.value), ['salesOrder']);
});

test('a failed catalog call falls back to the built-in list and is not cached', async () => {
	let fail = true;
	const ctx = makeContext('222', () => {
		if (fail) throw new Error('timeout');
		return { items: [{ name: 'vendor' }] };
	});
	const first = await searchRecordTypes.call(ctx);
	assert.ok(first.results.some((r) => r.value === 'customer'));
	fail = false;
	const second = await searchRecordTypes.call(ctx);
	assert.deepEqual(second.results.map((r) => r.value), ['vendor']);
});

test('record type picker opens without a request and accepts a typed ID', () => {
	const p = recordTypeProperty('x');
	assert.equal(p.type, 'resourceLocator');
	assert.deepEqual(p.modes.map((m) => m.name), ['list', 'id']);
	assert.equal(p.default.value, 'customer');
});
