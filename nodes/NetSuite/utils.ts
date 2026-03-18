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
// Date formatting
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
		errorMessage += ' — Authentication failed. Verify your M2M credentials and certificate mapping. For setup help, visit solutionlabtech.com';
	} else if (statusCode === 403) {
		errorMessage += ' — This typically requires role/permission configuration in NetSuite. For help, visit solutionlabtech.com';
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
		const credentials = await context.getCredentials('netSuiteClientCredApi');
		const baseUrl = buildSuiteTalkBaseUrl(credentials.accountId as string);

		const response = await context.helpers.httpRequestWithAuthentication.call(
			context,
			'netSuiteClientCredApi',
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
