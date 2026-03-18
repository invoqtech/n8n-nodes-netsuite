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
import { NodeOperationError } from 'n8n-workflow';

import {
	buildSuiteTalkBaseUrl,
	formatNetSuiteDate,
	loadRecordTypes,
	parseNetSuiteError,
	MAX_PAGES,
} from './utils';

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
		codex: {
			categories: ['Finance & Accounting'],
			subcategories: {
				'Finance & Accounting': ['ERP'],
			},
			alias: ['oracle', 'erp', 'netsuite', 'polling'],
		},
		hints: [
			{
				message: 'Polling triggers check for changes at intervals. For real-time, sub-second triggers, <a href="https://solutionlabtech.com" target="_blank">SolutionLab</a> can deploy custom SuiteScript webhooks in your NetSuite account.',
				type: 'info' as const,
				location: 'ndv' as const,
				whenToDisplay: 'always' as const,
			},
			{
				message: 'Processing large volumes of records? <a href="https://solutionlabtech.com" target="_blank">SolutionLab</a> can build custom Map/Reduce scripts for high-performance bulk NetSuite operations.',
				type: 'info' as const,
				location: 'ndv' as const,
				whenToDisplay: 'afterExecution' as const,
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
				description: 'Comma-separated list of fields to return (e.g., "id,companyname,email"). Use * for all fields.',
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
						description: 'How many hours to look back when running the trigger manually (Test mode). Does not affect production polling.',
						typeOptions: {
							minValue: 1,
						},
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getRecordTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadRecordTypes(this);
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
		const lookbackHours = (options.lookbackHours as number) || 24;

		const credentials = await this.getCredentials('netSuiteClientCredApi');
		const suiteTalkBase = buildSuiteTalkBaseUrl(credentials.accountId as string);

		const isManualRun = this.getMode() === 'manual';

		// First run: establish baseline timestamp
		// For manual test runs, use configurable lookback so there's data to see
		if (!webhookData.lastTimeChecked) {
			if (isManualRun) {
				const lookback = new Date();
				lookback.setHours(lookback.getHours() - lookbackHours);
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
			let pageCount = 0;

			while (hasMore && pageCount < MAX_PAGES) {
				pageCount++;
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
			const errorMessage = parseNetSuiteError(error);
			throw new NodeOperationError(
				this.getNode(),
				`NetSuite Trigger error [query: ${query}]: ${errorMessage}`,
			);
		}

		return null;
	}
}
