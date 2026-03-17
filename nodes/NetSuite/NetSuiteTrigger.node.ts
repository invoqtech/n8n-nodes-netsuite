import type {
	IDataObject,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';

function normalizeAccountId(accountId: string): string {
	return accountId.toLowerCase().replace(/_/g, '-');
}

function formatNetSuiteDate(date: Date): string {
	const mm = String(date.getMonth() + 1).padStart(2, '0');
	const dd = String(date.getDate()).padStart(2, '0');
	const yyyy = date.getFullYear();
	const hh = String(date.getHours()).padStart(2, '0');
	const mi = String(date.getMinutes()).padStart(2, '0');
	const ss = String(date.getSeconds()).padStart(2, '0');
	return `${mm}/${dd}/${yyyy} ${hh}:${mi}:${ss}`;
}

export class NetSuiteTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'NetSuite Trigger',
		name: 'netSuiteTriggerV2',
		icon: 'file:netsuite.png',
		group: ['trigger'],
		version: 1,
		polling: true,
		subtitle: '={{$parameter["event"] + " on " + $parameter["recordType"]}}',
		description: 'Starts the workflow when NetSuite records are created or updated',
		defaults: {
			name: 'NetSuite Trigger',
		},
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'netSuiteClientCredApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Record Type',
				name: 'recordType',
				type: 'options',
				default: 'customer',
				typeOptions: {
					loadOptionsMethod: 'getRecordTypes',
				},
				description: 'The type of record to monitor. Choose from the list or enter a custom ID.',
				required: true,
			},
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				options: [
					{
						name: 'Record Created',
						value: 'created',
						description: 'Trigger when a new record is created',
					},
					{
						name: 'Record Updated',
						value: 'updated',
						description: 'Trigger when an existing record is modified (excludes newly created records)',
					},
					{
						name: 'Record Created or Updated',
						value: 'createdOrUpdated',
						description: 'Trigger when a record is created or modified',
					},
				],
				default: 'createdOrUpdated',
				description: 'The event type to listen for',
				required: true,
			},
			{
				displayName: 'Return Fields',
				name: 'returnFields',
				type: 'string',
				default: '*',
				description: 'Comma-separated list of fields to return (e.g., "id, companyname, email"). Use * for all fields.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Date Field (Created)',
						name: 'dateCreatedField',
						type: 'string',
						default: 'datecreated',
						description: 'The SuiteQL field name for record creation date. Override for custom records that use a different field.',
					},
					{
						displayName: 'Date Field (Modified)',
						name: 'dateModifiedField',
						type: 'string',
						default: 'lastmodifieddate',
						description: 'The SuiteQL field name for last modified date. Override for custom records that use a different field.',
					},
					{
						displayName: 'Additional Filters',
						name: 'additionalFilters',
						type: 'string',
						default: '',
						placeholder: 'AND subsidiary = 1',
						description: 'Additional SuiteQL WHERE clause fragment to narrow the polling scope (e.g., "AND subsidiary = 1")',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getRecordTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const returnData: INodePropertyOptions[] = [];
				try {
					const credentials = await this.getCredentials('netSuiteClientCredApi');
					const accountId = normalizeAccountId(credentials.accountId as string);
					const baseUrl = `https://${accountId}.suitetalk.api.netsuite.com/services/rest`;

					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
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
					// Fallback to common record types if API call fails
				}

				if (returnData.length === 0) {
					returnData.push(
						{ name: 'Customer', value: 'customer' },
						{ name: 'Employee', value: 'employee' },
						{ name: 'Invoice', value: 'invoice' },
						{ name: 'Item', value: 'item' },
						{ name: 'Journal Entry', value: 'journalEntry' },
						{ name: 'Purchase Order', value: 'purchaseOrder' },
						{ name: 'Sales Order', value: 'salesOrder' },
						{ name: 'Vendor', value: 'vendor' },
						{ name: 'Vendor Bill', value: 'vendorBill' },
					);
				}

				return returnData;
			},
		},
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const webhookData = this.getWorkflowStaticData('node');
		const recordType = this.getNodeParameter('recordType') as string;
		const event = this.getNodeParameter('event') as string;
		const returnFields = this.getNodeParameter('returnFields', '*') as string;
		const options = this.getNodeParameter('options', {}) as IDataObject;

		const dateCreatedField = (options.dateCreatedField as string) || 'datecreated';
		const dateModifiedField = (options.dateModifiedField as string) || 'lastmodifieddate';
		const additionalFilters = (options.additionalFilters as string) || '';

		const credentials = await this.getCredentials('netSuiteClientCredApi');
		const accountId = normalizeAccountId(credentials.accountId as string);
		const suiteTalkBase = `https://${accountId}.suitetalk.api.netsuite.com/services/rest`;

		const isManualRun = this.getMode() === 'manual';

		// First run: establish baseline timestamp
		// For manual test runs, use a 24-hour lookback so there's data to see
		if (!webhookData.lastTimeChecked) {
			if (isManualRun) {
				const lookback = new Date();
				lookback.setHours(lookback.getHours() - 24);
				webhookData.lastTimeChecked = formatNetSuiteDate(lookback);
			} else {
				webhookData.lastTimeChecked = formatNetSuiteDate(new Date());
				return null;
			}
		}

		const lastTimeChecked = webhookData.lastTimeChecked as string;
		const now = formatNetSuiteDate(new Date());

		// Build SuiteQL WHERE clause based on event type
		const fields = returnFields.trim() || '*';
		let whereClause: string;

		switch (event) {
			case 'created':
				whereClause = `${dateCreatedField} >= TO_DATE('${lastTimeChecked}', 'MM/DD/YYYY HH24:MI:SS')`;
				break;
			case 'updated':
				whereClause = `${dateModifiedField} >= TO_DATE('${lastTimeChecked}', 'MM/DD/YYYY HH24:MI:SS') AND ${dateCreatedField} < TO_DATE('${lastTimeChecked}', 'MM/DD/YYYY HH24:MI:SS')`;
				break;
			case 'createdOrUpdated':
			default:
				whereClause = `${dateModifiedField} >= TO_DATE('${lastTimeChecked}', 'MM/DD/YYYY HH24:MI:SS')`;
				break;
		}

		if (additionalFilters) {
			whereClause += ` ${additionalFilters}`;
		}

		const query = `SELECT ${fields} FROM ${recordType} WHERE ${whereClause}`;

		this.logger.info(`NetSuite Trigger polling: ${query}`);

		try {
			const allItems: IDataObject[] = [];
			let offset = 0;
			let hasMore = true;
			const limit = 1000;

			while (hasMore) {
				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					'netSuiteClientCredApi',
					{
						method: 'POST',
						url: `${suiteTalkBase}/query/v1/suiteql`,
						qs: { limit, offset },
						body: { q: query },
						headers: {
							'Content-Type': 'application/json',
							Prefer: 'transient',
						},
					} as IHttpRequestOptions,
				)) as IDataObject;

				const items = (response.items as IDataObject[]) || [];
				allItems.push(...items);

				if (!response.hasMore) {
					hasMore = false;
				} else {
					offset += items.length;
				}
			}

			// Update timestamp for next poll
			webhookData.lastTimeChecked = now;

			this.logger.info(`NetSuite Trigger found ${allItems.length} record(s)`);

			if (allItems.length > 0) {
				// Add trigger metadata to each item
				const enrichedItems = allItems.map((item) => ({
					...item,
					_triggerMeta: {
						query,
						event,
						recordType,
						polledFrom: lastTimeChecked,
						polledTo: now,
					},
				}));
				return [this.helpers.returnJsonArray(enrichedItems)];
			}

			// Return debug info on manual runs even when no results found
			if (isManualRun) {
				return [this.helpers.returnJsonArray([{
					_triggerMeta: {
						message: 'No records found matching the query',
						query,
						event,
						recordType,
						polledFrom: lastTimeChecked,
						polledTo: now,
					},
				}])];
			}
		} catch (error) {
			let errorMessage = (error as Error).message;

			// Try to extract NetSuite structured error details
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

			throw new Error(`NetSuite Trigger error [query: ${query}]: ${errorMessage}`);
		}

		// Update timestamp even when no results found
		webhookData.lastTimeChecked = now;

		return null;
	}
}
