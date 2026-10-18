import type {
	IDataObject,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	applyWatermark,
	buildBaselineQuery,
	buildSuiteTalkBaseUrl,
	buildTriggerQuery,
	EPOCH_WATERMARK,
	recordTypeProperty,
	searchRecordTypes,
	parseNetSuiteError,
	shiftTimestamp,
	MAX_PAGES,
	type TriggerState,
	WM_COLUMN,
} from './utils';

export class NetSuiteTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'NetSuite Trigger',
		name: 'netSuiteTrigger',
		icon: { light: 'file:netsuite.svg', dark: 'file:netsuite.dark.svg' },
		group: ['trigger'],
		version: 1,
		polling: true,
		subtitle: '={{$parameter["event"] + " on " + ($parameter["recordType"].value || $parameter["recordType"])}}',
		description: 'Starts the workflow when NetSuite records are created or updated',
		defaults: {
			name: 'NetSuite Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'netSuiteInvoqApi',
				required: true,
			},
		],
		codex: {
			categories: ['Finance & Accounting'],
			subcategories: {
				'Finance & Accounting': ['ERP'],
			},
			alias: ['oracle', 'erp', 'netsuite', 'polling'],
		},
		hints: [
			{
				message: 'Polling triggers check for changes at intervals. For real-time, sub-second triggers, <a href="https://invoqtech.com/?utm_source=n8n&utm_medium=node-hint" target="_blank">InvoQ</a> can deploy custom SuiteScript webhooks in your NetSuite account.',
				type: 'info' as const,
				location: 'ndv' as const,
				whenToDisplay: 'always' as const,
			},
			{
				message: 'Processing large volumes of records? <a href="https://invoqtech.com/?utm_source=n8n&utm_medium=node-hint" target="_blank">InvoQ</a> can build custom Map/Reduce scripts for high-performance bulk NetSuite operations.',
				type: 'info' as const,
				location: 'ndv' as const,
				whenToDisplay: 'afterExecution' as const,
			},
		],
		properties: [
			recordTypeProperty('The type of record to monitor. Pick from the list or type its ID.'),
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
				description: 'Comma-separated list of fields to return (e.g., "ID,companyname,email"). Use * for all fields.',
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
					{
						displayName: 'Manual Test Lookback (Hours)',
						name: 'lookbackHours',
						type: 'number',
						default: 24,
						description: 'When testing manually, how many hours before the most recent change in NetSuite to start from. Does not affect production polling.',
						typeOptions: {
							minValue: 1,
						},
					},
				],
			},
		],
	};

	methods = {
		listSearch: {
			searchRecordTypes,
		},
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const webhookData = this.getWorkflowStaticData('node');
		const recordType = this.getNodeParameter('recordType', '', { extractValue: true }) as string;
		const event = this.getNodeParameter('event') as string;
		const returnFields = this.getNodeParameter('returnFields', '*') as string;
		const options = this.getNodeParameter('options', {}) as IDataObject;

		const dateCreatedField = (options.dateCreatedField as string) || 'datecreated';
		const dateModifiedField = (options.dateModifiedField as string) || 'lastmodifieddate';
		const additionalFilters = (options.additionalFilters as string) || '';
		const lookbackHours = (options.lookbackHours as number) || 24;
		const watermarkField = event === 'created' ? dateCreatedField : dateModifiedField;

		const credentials = await this.getCredentials('netSuiteInvoqApi');
		const suiteTalkBase = buildSuiteTalkBaseUrl(credentials.accountId as string);
		const isManualRun = this.getMode() === 'manual';

		const runSuiteQL = async (q: string, limit: number, offset: number) =>
			(await this.helpers.httpRequestWithAuthentication.call(this, 'netSuiteInvoqApi', {
				method: 'POST',
				url: `${suiteTalkBase}/query/v1/suiteql`,
				qs: { limit, offset },
				body: { q },
				headers: {
					'Content-Type': 'application/json',
					Prefer: 'transient',
				},
			} as IHttpRequestOptions)) as IDataObject;

		let query = '';
		try {
			// Baseline: the newest timestamp NetSuite already holds for this record type.
			// Taken from NetSuite itself so the n8n server's clock and time zone never matter.
			// State saved by versions before 1.0.0 (lastTimeChecked) is replaced, not replayed.
			let state = webhookData.trigger as TriggerState | undefined;
			if (!state || !state.watermark) {
				query = buildBaselineQuery(recordType, watermarkField);
				const res = await runSuiteQL(query, 1, 0);
				const items = (res.items as IDataObject[]) || [];
				const latest = (items[0]?.[WM_COLUMN] as string) || EPOCH_WATERMARK;
				if (!isManualRun) {
					webhookData.trigger = { watermark: latest, boundaryIds: [] } as TriggerState;
					delete webhookData.lastTimeChecked;
					return null;
				}
				state = { watermark: shiftTimestamp(latest, -lookbackHours), boundaryIds: [] };
			}

			query = buildTriggerQuery({
				recordType,
				event,
				fields: returnFields,
				dateCreatedField,
				dateModifiedField,
				additionalFilters,
				watermark: state.watermark,
			});
			this.logger.info(`NetSuite Trigger polling: ${query}`);

			const rows: IDataObject[] = [];
			let offset = 0;
			let pageCount = 0;
			let hasMore = true;
			while (hasMore && pageCount < MAX_PAGES) {
				pageCount++;
				const response = await runSuiteQL(query, 1000, offset);
				const pageItems = (response.items as IDataObject[]) || [];
				rows.push(...pageItems);
				hasMore = Boolean(response.hasMore) && pageItems.length > 0;
				offset += pageItems.length;
			}

			const { items, next } = applyWatermark(rows, state);
			if (!isManualRun) {
				webhookData.trigger = next;
				delete webhookData.lastTimeChecked;
			}

			this.logger.info(`NetSuite Trigger found ${items.length} new record(s)`);

			const meta = {
				query,
				event,
				recordType,
				polledFrom: state.watermark,
				watermark: next.watermark,
			};

			if (items.length > 0) {
				return [this.helpers.returnJsonArray(items.map((item) => ({ ...item, _triggerMeta: meta })))];
			}

			if (isManualRun) {
				return [
					this.helpers.returnJsonArray([
						{ _triggerMeta: { message: 'No records found matching the query', ...meta } },
					]),
				];
			}
		} catch (error) {
			const errorMessage = parseNetSuiteError(error);
			throw new NodeOperationError(
				this.getNode(),
				`NetSuite Trigger error [query: ${query}]: ${errorMessage}`,
			);
		}

		return null;
	}
}
