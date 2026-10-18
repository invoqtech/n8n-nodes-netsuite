// Run with: npm run build && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const {
	applyWatermark,
	buildBaselineQuery,
	buildTriggerQuery,
	shiftTimestamp,
	WM_COLUMN,
	WM_ID_COLUMN,
} = require('../dist/nodes/NetSuite/utils.js');

const row = (id, wm, extra = {}) => ({ id, [WM_ID_COLUMN]: id, [WM_COLUMN]: wm, links: [], ...extra });

test('shiftTimestamp moves whole hours across day and month boundaries without time zones', () => {
	assert.equal(shiftTimestamp('2026-11-01 01:30:00', -24), '2026-10-31 01:30:00');
	assert.equal(shiftTimestamp('2026-03-29 02:15:00', -3), '2026-03-28 23:15:00');
	assert.equal(shiftTimestamp('not a timestamp', -1), 'not a timestamp');
});

test('baseline query asks NetSuite for its own newest timestamp', () => {
	assert.equal(
		buildBaselineQuery('customer', 'lastmodifieddate'),
		"SELECT TO_CHAR(MAX(lastmodifieddate), 'YYYY-MM-DD HH24:MI:SS') AS ns_trigger_wm FROM customer",
	);
});

test('trigger query compares in NetSuite format and orders for stable paging', () => {
	const q = buildTriggerQuery({
		recordType: 'customer',
		event: 'updated',
		fields: '*',
		dateCreatedField: 'datecreated',
		dateModifiedField: 'lastmodifieddate',
		additionalFilters: 'AND subsidiary = 1',
		watermark: '2026-10-17 09:00:00',
	});
	assert.match(q, /^SELECT t\.\*, t\.id AS ns_trigger_id, TO_CHAR\(t\.lastmodifieddate, 'YYYY-MM-DD HH24:MI:SS'\) AS ns_trigger_wm FROM customer t WHERE /);
	assert.match(q, /t\.lastmodifieddate >= TO_DATE\('2026-10-17 09:00:00', 'YYYY-MM-DD HH24:MI:SS'\)/);
	assert.match(q, /AND t\.datecreated < TO_DATE\('2026-10-17 09:00:00'/);
	assert.match(q, /AND subsidiary = 1 ORDER BY t\.lastmodifieddate, t\.id$/);
});

test('created event watches the created field', () => {
	const q = buildTriggerQuery({
		recordType: 'invoice',
		event: 'created',
		fields: 'id, tranid',
		dateCreatedField: 'datecreated',
		dateModifiedField: 'lastmodifieddate',
		additionalFilters: '',
		watermark: '2026-10-17 09:00:00',
	});
	assert.match(q, /^SELECT id, tranid, t\.id AS ns_trigger_id, TO_CHAR\(t\.datecreated/);
	assert.match(q, /ORDER BY t\.datecreated, t\.id$/);
});

test('watermark advances to newest row and remembers ids on that second', () => {
	const { items, next } = applyWatermark(
		[row('1', '2026-10-17 09:00:00'), row('2', '2026-10-17 09:05:00'), row('3', '2026-10-17 09:05:00')],
		{ watermark: '2026-10-17 09:00:00', boundaryIds: [] },
	);
	assert.deepEqual(items.map((i) => i.id), ['1', '2', '3']);
	assert.deepEqual(next, { watermark: '2026-10-17 09:05:00', boundaryIds: ['2', '3'] });
	assert.equal(items[0][WM_COLUMN], undefined);
	assert.equal(items[0][WM_ID_COLUMN], undefined);
	assert.equal(items[0].links, undefined);
});

test('rows already emitted on the boundary second are not emitted again', () => {
	const { items, next } = applyWatermark(
		[row('2', '2026-10-17 09:05:00'), row('3', '2026-10-17 09:05:00'), row('4', '2026-10-17 09:05:00')],
		{ watermark: '2026-10-17 09:05:00', boundaryIds: ['2', '3'] },
	);
	assert.deepEqual(items.map((i) => i.id), ['4']);
	assert.deepEqual(next.boundaryIds.sort(), ['2', '3', '4']);
});

test('a record modified again after it fired fires again', () => {
	const { items } = applyWatermark([row('2', '2026-10-17 09:10:00')], {
		watermark: '2026-10-17 09:05:00',
		boundaryIds: ['2'],
	});
	assert.deepEqual(items.map((i) => i.id), ['2']);
});

test('an empty poll keeps the state unchanged', () => {
	const state = { watermark: '2026-10-17 09:05:00', boundaryIds: ['2'] };
	const { items, next } = applyWatermark([], state);
	assert.equal(items.length, 0);
	assert.deepEqual(next, state);
});
