import type {
	IDataObject,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
} from 'n8n-workflow';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Safety limit for pagination loops to prevent infinite iteration */
export const MAX_PAGES = 500;

// ---------------------------------------------------------------------------
// Account & URL helpers
// ---------------------------------------------------------------------------

export function normalizeAccountId(accountId: string): string {
	return accountId.toLowerCase().replace(/_/g, '-');
}

export function buildSuiteTalkBaseUrl(accountId: string): string {
	return `https://${normalizeAccountId(accountId)}.suitetalk.api.netsuite.com/services/rest`;
}

export function buildRestletBaseUrl(accountId: string): string {
	return `https://${normalizeAccountId(accountId)}.restlets.api.netsuite.com/app/site/hosting/restlet.nl`;
}

// ---------------------------------------------------------------------------
// Trigger watermark helpers
//
// All trigger timestamps are produced by NetSuite itself (TO_CHAR in the
// user's NetSuite time zone) and compared back with TO_DATE in the same
// session, so the n8n server clock and time zone never enter the comparison.
// ---------------------------------------------------------------------------

/** Format used for every trigger timestamp, on both sides of the comparison */
export const NS_TS_FORMAT = 'YYYY-MM-DD HH24:MI:SS';

/** Watermark used when the monitored table is empty */
export const EPOCH_WATERMARK = '1970-01-01 00:00:00';

/** Helper columns the trigger adds to its query and strips from output */
export const WM_COLUMN = 'ns_trigger_wm';
export const WM_ID_COLUMN = 'ns_trigger_id';

export interface TriggerState {
	watermark: string;
	boundaryIds: string[];
}

/** Shift a NetSuite-local timestamp by whole hours without involving any time zone */
export function shiftTimestamp(ts: string, hours: number): string {
	const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(ts);
	if (!m) return ts;
	const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + hours * 3600000;
	return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

export function buildBaselineQuery(recordType: string, watermarkField: string): string {
	return `SELECT TO_CHAR(MAX(${watermarkField}), '${NS_TS_FORMAT}') AS ${WM_COLUMN} FROM ${recordType}`;
}

export function buildTriggerQuery(opts: {
	recordType: string;
	event: string;
	fields: string;
	dateCreatedField: string;
	dateModifiedField: string;
	additionalFilters: string;
	watermark: string;
}): string {
	const wmField = opts.event === 'created' ? opts.dateCreatedField : opts.dateModifiedField;
	const since = `TO_DATE('${opts.watermark}', '${NS_TS_FORMAT}')`;
	const selected = opts.fields.trim() === '*' || !opts.fields.trim() ? 't.*' : opts.fields;
	let where = `t.${wmField} >= ${since}`;
	if (opts.event === 'updated') {
		where += ` AND t.${opts.dateCreatedField} < ${since}`;
	}
	if (opts.additionalFilters.trim()) {
		where += ` ${opts.additionalFilters.trim()}`;
	}
	return (
		`SELECT ${selected}, t.id AS ${WM_ID_COLUMN}, TO_CHAR(t.${wmField}, '${NS_TS_FORMAT}') AS ${WM_COLUMN} ` +
		`FROM ${opts.recordType} t WHERE ${where} ORDER BY t.${wmField}, t.id`
	);
}

/**
 * Drop rows already emitted on the previous watermark second, strip helper
 * columns, and compute the state for the next poll.
 */
export function applyWatermark(
	rows: IDataObject[],
	state: TriggerState,
): { items: IDataObject[]; next: TriggerState } {
	const seen = new Set(state.boundaryIds);
	let watermark = state.watermark;
	let boundary = new Set(state.boundaryIds);
	const items: IDataObject[] = [];

	for (const row of rows) {
		const wm = String(row[WM_COLUMN] ?? '');
		const id = String(row[WM_ID_COLUMN] ?? '');
		if (wm === state.watermark && seen.has(id)) continue;

		if (wm > watermark) {
			watermark = wm;
			boundary = new Set();
		}
		if (wm === watermark) boundary.add(id);

		const item = { ...row };
		delete item[WM_COLUMN];
		delete item[WM_ID_COLUMN];
		delete item.links;
		items.push(item);
	}

	return { items, next: { watermark, boundaryIds: [...boundary] } };
}

// ---------------------------------------------------------------------------

export function formatNetSuiteDate(date: Date): string {
	const mm = String(date.getMonth() + 1).padStart(2, '0');
	const dd = String(date.getDate()).padStart(2, '0');
	const yyyy = date.getFullYear();
	const hh = String(date.getHours()).padStart(2, '0');
	const mi = String(date.getMinutes()).padStart(2, '0');
	const ss = String(date.getSeconds()).padStart(2, '0');
	return `${mm}/${dd}/${yyyy} ${hh}:${mi}:${ss}`;
}

// ---------------------------------------------------------------------------
// Error parsing
// ---------------------------------------------------------------------------

export function parseNetSuiteError(error: unknown): string {
	let errorMessage = (error as Error).message;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const err = error as any;
	if (err.description) {
		try {
			const errBody = JSON.parse(err.description as string) as IDataObject;
			if (errBody['o:errorDetails']) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const details = errBody['o:errorDetails'] as any[];
				if (Array.isArray(details) && details.length > 0) {
					errorMessage = details
						.map(
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							(d: any) =>
								`${(d['o:errorCode'] as string) || 'ERROR'}: ${(d.detail as string) || (d.message as string) || ''}`,
						)
						.join('; ');
				}
			} else if (errBody.title) {
				errorMessage = `${errBody.title as string}: ${(errBody.detail as string) || (errBody['o:errorCode'] as string) || ''}`;
			}
		} catch {
			// Response is not JSON, keep original error message
		}
	}

	// Add contextual help for common error codes
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const statusCode = (error as any).statusCode || (error as any).httpCode;
	if (statusCode === 400) {
		errorMessage += ' — Check that field names and values match NetSuite\'s expected format for this record type.';
	} else if (statusCode === 401) {
		errorMessage += ' — Authentication failed. Verify your M2M credentials and certificate mapping. For setup help, visit invoqtech.com';
	} else if (statusCode === 403) {
		errorMessage += ' — This typically requires role/permission configuration in NetSuite. For help, visit invoqtech.com';
	} else if (statusCode === 404) {
		errorMessage += ' — Record or resource not found. Verify the record type and ID exist in your NetSuite account.';
	}

	return errorMessage;
}

// ---------------------------------------------------------------------------
// Fallback record types
// ---------------------------------------------------------------------------

export const FALLBACK_RECORD_TYPES: INodePropertyOptions[] = [
	{ name: 'Contact', value: 'contact' },
	{ name: 'Credit Memo', value: 'creditMemo' },
	{ name: 'Customer', value: 'customer' },
	{ name: 'Deposit', value: 'deposit' },
	{ name: 'Employee', value: 'employee' },
	{ name: 'Estimate', value: 'estimate' },
	{ name: 'Expense Report', value: 'expenseReport' },
	{ name: 'Invoice', value: 'invoice' },
	{ name: 'Item', value: 'item' },
	{ name: 'Item Fulfillment', value: 'itemFulfillment' },
	{ name: 'Journal Entry', value: 'journalEntry' },
	{ name: 'Opportunity', value: 'opportunity' },
	{ name: 'Payment', value: 'customerPayment' },
	{ name: 'Purchase Order', value: 'purchaseOrder' },
	{ name: 'Return Authorization', value: 'returnAuthorization' },
	{ name: 'Sales Order', value: 'salesOrder' },
	{ name: 'Task', value: 'task' },
	{ name: 'Transfer Order', value: 'transferOrder' },
	{ name: 'Vendor', value: 'vendor' },
	{ name: 'Vendor Bill', value: 'vendorBill' },
];

// ---------------------------------------------------------------------------
// Shared load options
// ---------------------------------------------------------------------------

export async function loadRecordTypes(
	context: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const returnData: INodePropertyOptions[] = [];
	try {
		const credentials = await context.getCredentials('netSuiteInvoqApi');
		const baseUrl = buildSuiteTalkBaseUrl(credentials.accountId as string);

		const response = await context.helpers.httpRequestWithAuthentication.call(
			context,
			'netSuiteInvoqApi',
			{
				method: 'GET',
				url: `${baseUrl}/record/v1/metadata-catalog`,
				headers: {
					Prefer: 'transient',
				},
			} as IHttpRequestOptions,
		);

		if (response && response.items) {
			for (const item of response.items as Array<{ name?: string }>) {
				if (item.name) {
					returnData.push({
						name: item.name,
						value: item.name,
					});
				}
			}
		}

		returnData.sort((a, b) => {
			if (a.name < b.name) return -1;
			if (a.name > b.name) return 1;
			return 0;
		});
	} catch (_error) {
		context.logger.warn(
			'Failed to load NetSuite record types from metadata catalog, using fallback list',
			{ error: (_error as Error).message },
		);
	}

	if (returnData.length === 0) {
		returnData.push(...FALLBACK_RECORD_TYPES);
	}

	return returnData;
}

// ---------------------------------------------------------------------------
// SuiteQL template queries
// ---------------------------------------------------------------------------

export const SUITEQL_TEMPLATES: Record<string, string> = {
	custom: '',
	activeCustomers:
		"SELECT id, companyname, email, phone, datecreated FROM customer WHERE isinactive = 'F' ORDER BY companyname",
	recentSalesOrders:
		"SELECT id, tranid, entity, trandate, status, foreigntotal FROM transaction WHERE type = 'SalesOrd' AND trandate >= SYSDATE - 30 ORDER BY trandate DESC",
	openInvoices:
		"SELECT id, tranid, entity, trandate, duedate, foreigntotal, status FROM transaction WHERE type = 'CustInvc' AND status != 'CustInvc:B' ORDER BY duedate",
	inventoryLevels:
		'SELECT item.id, item.itemid, item.displayname, item.quantityonhand, item.quantityavailable FROM item WHERE item.quantityonhand IS NOT NULL ORDER BY item.itemid',
	employeeDirectory:
		"SELECT id, firstname, lastname, email, title, department FROM employee WHERE isinactive = 'F' ORDER BY lastname, firstname",
	recentVendorBills:
		"SELECT id, tranid, entity, trandate, foreigntotal FROM transaction WHERE type = 'VendBill' AND trandate >= SYSDATE - 30 ORDER BY trandate DESC",
};
