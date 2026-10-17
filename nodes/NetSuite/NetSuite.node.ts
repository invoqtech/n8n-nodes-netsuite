import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	buildSuiteTalkBaseUrl,
	buildRestletBaseUrl,
	loadRecordTypes,
	parseNetSuiteError,
	SUITEQL_TEMPLATES,
	MAX_PAGES,
} from './utils';

export class NetSuite implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'NetSuite',
		name: 'netSuite',
		icon: { light: 'file:netsuite.svg', dark: 'file:netsuite.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with NetSuite via REST API, SuiteQL, and Restlets using OAuth 2.0 Client Credentials',
		defaults: {
			name: 'NetSuite',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
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
			alias: ['oracle', 'erp', 'suiteql', 'restlet', 'suitescript', 'netsuite'],
		},
		hints: [
			{
				message: 'Need help with complex NetSuite integrations? <a href="https://invoqtech.com/?utm_source=n8n&utm_medium=node-hint" target="_blank">InvoQ</a> offers custom SuiteScript development and integration consulting.',
				type: 'info' as const,
				location: 'ndv' as const,
				whenToDisplay: 'always' as const,
				displayCondition: '={{ $parameter.resource === "restlet" }}',
			},
			{
				message: 'Tip: Need to filter or select specific fields? Use the <b>SuiteQL</b> resource instead — it supports full SQL-like queries with WHERE clauses, JOINs, and field selection.',
				type: 'info' as const,
				location: 'ndv' as const,
				whenToDisplay: 'beforeExecution' as const,
				displayCondition: '={{ $parameter.resource === "record" && $parameter.operation === "getAll" }}',
			},
			{
				message: 'Need to create records with line items (invoices, sales orders)? These require nested JSON structures. <a href="https://invoqtech.com/?utm_source=n8n&utm_medium=node-hint" target="_blank">InvoQ</a> can help with complex transaction workflows.',
				type: 'info' as const,
				location: 'ndv' as const,
				whenToDisplay: 'beforeExecution' as const,
				displayCondition: '={{ $parameter.resource === "record" && $parameter.operation === "create" }}',
			},
			{
				message: 'Need help with complex SuiteQL JOINs or custom record queries? <a href="https://invoqtech.com/?utm_source=n8n&utm_medium=node-hint" target="_blank">InvoQ</a> offers SuiteQL and integration consulting.',
				type: 'info' as const,
				location: 'ndv' as const,
				whenToDisplay: 'beforeExecution' as const,
				displayCondition: '={{ $parameter.resource === "suiteql" }}',
			},
		],
		properties: [
			// ----------------------------------
			//         Resource
			// ----------------------------------
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Record',
						value: 'record',
					},
					{
						name: 'Restlet',
						value: 'restlet',
					},
					{
						name: 'SuiteQL',
						value: 'suiteql',
					},
				],
				default: 'record',
			},

			// ----------------------------------
			//         Record Operations
			// ----------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['record'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Create a new record',
						action: 'Create a record',
					},
					{
						name: 'Create or Update',
						value: 'upsert',
						description: 'Create a new record, or update the current one if it already exists (upsert)',
						action: 'Upsert a record',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a record',
						action: 'Delete a record',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a record',
						action: 'Get a record',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many records',
						action: 'Get many records',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a record',
						action: 'Update a record',
					},
				],
				default: 'get',
			},

			// ----------------------------------
			//         Restlet Operations
			// ----------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['restlet'],
					},
				},
				options: [
					{
						name: 'DELETE',
						value: 'delete',
						description: 'Execute a Restlet DELETE request',
						action: 'Execute a restlet DELETE',
					},
					{
						name: 'GET',
						value: 'get',
						description: 'Execute a Restlet GET request',
						action: 'Execute a restlet GET',
					},
					{
						name: 'POST',
						value: 'post',
						description: 'Execute a Restlet POST request',
						action: 'Execute a restlet POST',
					},
					{
						name: 'PUT',
						value: 'put',
						description: 'Execute a Restlet PUT request',
						action: 'Execute a restlet PUT',
					},
				],
				default: 'get',
			},

			// ----------------------------------
			//         SuiteQL Operations
			// ----------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['suiteql'],
					},
				},
				options: [
					{
						name: 'Execute',
						value: 'execute',
						description: 'Execute a SuiteQL query',
						action: 'Run a query',
					},
				],
				default: 'execute',
			},

			// ----------------------------------
			//         Record Fields
			// ----------------------------------
			{
				displayName: 'Record Type Name or ID',
				name: 'recordType',
				type: 'options',
				default: 'customer',
				typeOptions: {
					loadOptionsMethod: 'getRecordTypes',
				},
				description: 'The type of record to access. Choose from the list or enter a custom ID. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: {
					show: {
						resource: ['record'],
					},
				},
			},
			{
				displayName: 'Record ID',
				name: 'recordId',
				type: 'string',
				default: '',
				description: 'The internal ID of the record',
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['get', 'delete', 'update'],
					},
				},
			},
			{
				displayName: 'External ID Field',
				name: 'externalIdField',
				type: 'string',
				default: 'externalid',
				description: 'The field name used to match records for upsert (e.g., "externalid" or a custom field)',
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['upsert'],
					},
				},
			},
			{
				displayName: 'External ID Value',
				name: 'externalIdValue',
				type: 'string',
				default: '',
				description: 'The value of the external ID field to match for upsert',
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['upsert'],
					},
				},
			},
			{
				displayName: 'Fields',
				name: 'fields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['create', 'update', 'upsert'],
					},
				},
				options: [
					{
						displayName: 'JSON Fields',
						name: 'jsonFields',
						type: 'json',
						default: '{}',
						placeholder: '{"companyname": "Acme Corp", "email": "contact@acme.com"}',
						description: 'JSON object representing the fields to set on the record',
					},
				],
			},

		{
				displayName: 'Return All',
				name: 'recordReturnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to automatically paginate through all results (may be slow for large datasets)',
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['getAll'],
					},
				},
			},
			{
				displayName: 'Limit',
				name: 'recordLimit',
				type: 'number',
				default: 1000,
				description: 'Max number of records to return',
				typeOptions: {
					minValue: 1,
				},
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['getAll'],
						recordReturnAll: [false],
					},
				},
			},
			{
				displayName: 'Additional Options',
				name: 'additionalOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['get'],
					},
				},
				options: [
					{
						displayName: 'Expand Sub-Resources',
						name: 'expandSubResources',
						type: 'boolean',
						default: false,
						description: 'Whether to include sublists (line items) in the response',
					},
					{
						displayName: 'Fields',
						name: 'fields',
						type: 'string',
						default: '',
						description: 'Comma-separated list of field names to return, for example companyname,email',
					},
				],
			},

			// ----------------------------------
			//         SuiteQL Fields
			// ----------------------------------
			{
				displayName: 'Query Template',
				name: 'queryTemplate',
				type: 'options',
				options: [
					{
						name: 'Active Customers',
						value: 'activeCustomers',
						description: 'List all active customers with key fields',
					},
					{
						name: 'Custom Query',
						value: 'custom',
						description: 'Write your own SuiteQL query',
					},
					{
						name: 'Employee Directory',
						value: 'employeeDirectory',
						description: 'All active employees with contact details',
					},
					{
						name: 'Inventory Levels',
						value: 'inventoryLevels',
						description: 'Items with on-hand and available quantities',
					},
					{
						name: 'Open Invoices',
						value: 'openInvoices',
						description: 'All unpaid invoices sorted by due date',
					},
					{
						name: 'Recent Sales Orders (30 Days)',
						value: 'recentSalesOrders',
						description: 'Sales orders from the last 30 days',
					},
					{
						name: 'Vendor Bills (30 Days)',
						value: 'recentVendorBills',
						description: 'Vendor bills from the last 30 days',
					},
				],
				default: 'custom',
				description: 'Start with a template query or write your own',
				displayOptions: {
					show: {
						resource: ['suiteql'],
						operation: ['execute'],
					},
				},
			},
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				typeOptions: {
					rows: 5,
				},
				default: '',
				placeholder: "SELECT id, companyname, email FROM customer WHERE isinactive = 'F'",
				description: 'The SuiteQL query to execute. With Return All on, end the query with an ORDER BY (for example ORDER BY t.ID) so pages do not overlap or skip rows.',
				displayOptions: {
					show: {
						resource: ['suiteql'],
						operation: ['execute'],
						queryTemplate: ['custom'],
					},
				},
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: {
					show: {
						resource: ['suiteql'],
						operation: ['execute'],
					},
				},
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				description: 'Max number of results to return',
				typeOptions: {
					minValue: 1,
				},
				displayOptions: {
					show: {
						resource: ['suiteql'],
						operation: ['execute'],
						returnAll: [false],
					},
				},
			},

			// ----------------------------------
			//         Restlet Fields
			// ----------------------------------
			{
				displayName: 'Script ID',
				name: 'scriptId',
				type: 'number',
				default: 0,
				required: true,
				description: 'The script ID of the Restlet deployment',
				displayOptions: {
					show: {
						resource: ['restlet'],
					},
				},
			},
			{
				displayName: 'Deploy ID',
				name: 'deployId',
				type: 'number',
				default: 1,
				description: 'The deployment ID of the Restlet (usually 1)',
				displayOptions: {
					show: {
						resource: ['restlet'],
					},
				},
			},
			{
				displayName: 'Body (JSON)',
				name: 'restletBody',
				type: 'json',
				default: '{}',
				description: 'The JSON body to send to the Restlet',
				displayOptions: {
					show: {
						resource: ['restlet'],
						operation: ['post', 'put'],
					},
				},
			},
			{
				displayName: 'Additional Parameters',
				name: 'restletParams',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				description: 'Additional query string parameters to send to the Restlet',
				displayOptions: {
					show: {
						resource: ['restlet'],
					},
				},
				options: [
					{
						name: 'parameter',
						displayName: 'Parameter',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
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

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: IDataObject[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const credentials = await this.getCredentials('netSuiteInvoqApi');
		const suiteTalkBase = buildSuiteTalkBaseUrl(credentials.accountId as string);
		const restletBase = buildRestletBaseUrl(credentials.accountId as string);

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: IDataObject | IDataObject[] | undefined;

				if (resource === 'record') {
					const recordType = this.getNodeParameter('recordType', i) as string;

					if (operation === 'get') {
						const recordId = this.getNodeParameter('recordId', i) as string;
						if (!recordId) {
							throw new NodeOperationError(this.getNode(), 'Record ID is required', { itemIndex: i });
						}
						const additionalOptions = this.getNodeParameter('additionalOptions', i, {}) as IDataObject;
						const qs: IDataObject = {};
						if (additionalOptions.fields) qs.fields = additionalOptions.fields;
						if (additionalOptions.expandSubResources) qs.expandSubResources = 'true';

						responseData = (await this.helpers.httpRequestWithAuthentication.call(
							this,
							'netSuiteInvoqApi',
							{
								method: 'GET',
								url: `${suiteTalkBase}/record/v1/${recordType}/${recordId}`,
								qs,
							} as IHttpRequestOptions,
						)) as IDataObject;
					} else if (operation === 'getAll') {
						const recordReturnAll = this.getNodeParameter('recordReturnAll', i, false) as boolean;
						const recordLimit = recordReturnAll ? 1000 : (this.getNodeParameter('recordLimit', i, 1000) as number);
						const qs: IDataObject = { limit: recordLimit };

						const allRecords: IDataObject[] = [];
						let nextUrl: string | undefined = `${suiteTalkBase}/record/v1/${recordType}`;
						let pageCount = 0;

						while (nextUrl && pageCount < MAX_PAGES) {
							pageCount++;
							const response = (await this.helpers.httpRequestWithAuthentication.call(
								this,
								'netSuiteInvoqApi',
								{
									method: 'GET',
									url: nextUrl,
									qs,
								} as IHttpRequestOptions,
							)) as IDataObject;

							const pageItems = (response.items as IDataObject[]) || [];
							allRecords.push(...pageItems);

							if (!recordReturnAll) {
								nextUrl = undefined;
							} else {
								const links = (response.links as Array<{ rel: string; href: string }>) || [];
								const nextLink = links.find((l) => l.rel === 'next');
								nextUrl = nextLink ? nextLink.href : undefined;
								// Clear qs for subsequent pages since nextUrl contains all params
								if (nextUrl) {
									Object.keys(qs).forEach((key) => delete qs[key]);
								}
							}
						}

						responseData = allRecords;
					} else if (operation === 'create') {
						const jsonFields = this.getNodeParameter('fields.jsonFields', i, '{}') as string;
						let body: IDataObject;
						try {
							body = JSON.parse(jsonFields) as IDataObject;
						} catch (e) {
							throw new NodeOperationError(
								this.getNode(),
								`Invalid JSON in Fields: ${(e as Error).message}. Value: ${jsonFields.substring(0, 100)}`,
								{ itemIndex: i },
							);
						}
						responseData = (await this.helpers.httpRequestWithAuthentication.call(
							this,
							'netSuiteInvoqApi',
							{
								method: 'POST',
								url: `${suiteTalkBase}/record/v1/${recordType}`,
								body,
								headers: { 'Content-Type': 'application/json' },
							} as IHttpRequestOptions,
						)) as IDataObject;
					} else if (operation === 'update') {
						const recordId = this.getNodeParameter('recordId', i) as string;
						if (!recordId) {
							throw new NodeOperationError(this.getNode(), 'Record ID is required', { itemIndex: i });
						}
						const jsonFields = this.getNodeParameter('fields.jsonFields', i, '{}') as string;
						let body: IDataObject;
						try {
							body = JSON.parse(jsonFields) as IDataObject;
						} catch (e) {
							throw new NodeOperationError(
								this.getNode(),
								`Invalid JSON in Fields: ${(e as Error).message}. Value: ${jsonFields.substring(0, 100)}`,
								{ itemIndex: i },
							);
						}
						responseData = (await this.helpers.httpRequestWithAuthentication.call(
							this,
							'netSuiteInvoqApi',
							{
								method: 'PATCH',
								url: `${suiteTalkBase}/record/v1/${recordType}/${recordId}`,
								body,
								headers: { 'Content-Type': 'application/json' },
							} as IHttpRequestOptions,
						)) as IDataObject;
					} else if (operation === 'upsert') {
						const externalIdField = this.getNodeParameter('externalIdField', i) as string;
						const externalIdValue = this.getNodeParameter('externalIdValue', i) as string;
						if (!externalIdValue) {
							throw new NodeOperationError(this.getNode(), 'External ID Value is required for upsert', { itemIndex: i });
						}
						const jsonFields = this.getNodeParameter('fields.jsonFields', i, '{}') as string;
						let body: IDataObject;
						try {
							body = JSON.parse(jsonFields) as IDataObject;
						} catch (e) {
							throw new NodeOperationError(
								this.getNode(),
								`Invalid JSON in Fields: ${(e as Error).message}. Value: ${jsonFields.substring(0, 100)}`,
								{ itemIndex: i },
							);
						}
						responseData = (await this.helpers.httpRequestWithAuthentication.call(
							this,
							'netSuiteInvoqApi',
							{
								method: 'PUT',
								url: `${suiteTalkBase}/record/v1/${recordType}/${externalIdField}=${externalIdValue}`,
								body,
								headers: { 'Content-Type': 'application/json' },
							} as IHttpRequestOptions,
						)) as IDataObject;
					} else if (operation === 'delete') {
						const recordId = this.getNodeParameter('recordId', i) as string;
						if (!recordId) {
							throw new NodeOperationError(this.getNode(), 'Record ID is required', { itemIndex: i });
						}
						await this.helpers.httpRequestWithAuthentication.call(
							this,
							'netSuiteInvoqApi',
							{
								method: 'DELETE',
								url: `${suiteTalkBase}/record/v1/${recordType}/${recordId}`,
							} as IHttpRequestOptions,
						);
						responseData = { success: true, id: recordId };
					}
				} else if (resource === 'suiteql') {
					const queryTemplate = this.getNodeParameter('queryTemplate', i, 'custom') as string;
					const query = queryTemplate === 'custom'
						? (this.getNodeParameter('query', i) as string)
						: SUITEQL_TEMPLATES[queryTemplate];
					const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
					const limit = returnAll ? 1000 : (this.getNodeParameter('limit', i, 1000) as number);

					const allItems: IDataObject[] = [];
					let offset = 0;
					let hasMore = true;
					let pageCount = 0;

					while (hasMore && pageCount < MAX_PAGES) {
						pageCount++;
						const response = (await this.helpers.httpRequestWithAuthentication.call(
							this,
							'netSuiteInvoqApi',
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

						const pageItems = (response.items as IDataObject[]) || [];
						allItems.push(...pageItems);

						if (!returnAll || !response.hasMore) {
							hasMore = false;
						} else {
							offset += pageItems.length;
						}
					}

					responseData = allItems;
				} else if (resource === 'restlet') {
					const scriptId = this.getNodeParameter('scriptId', i) as number;
					const deployId = this.getNodeParameter('deployId', i, 1) as number;
					const method = operation.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE';

					const qs: IDataObject = {
						script: scriptId,
						deploy: deployId,
					};

					// Add additional query parameters
					const additionalParams = this.getNodeParameter(
						'restletParams.parameter',
						i,
						[],
					) as Array<{ name: string; value: string }>;
					for (const param of additionalParams) {
						if (param.name) {
							qs[param.name] = param.value;
						}
					}

					const requestOptions: IHttpRequestOptions = {
						method,
						url: restletBase,
						qs,
						headers: { 'Content-Type': 'application/json' },
					};

					if (method === 'POST' || method === 'PUT') {
						const bodyJson = this.getNodeParameter('restletBody', i, '{}') as string;
						try {
							requestOptions.body = JSON.parse(bodyJson) as IDataObject;
						} catch (e) {
							throw new NodeOperationError(
								this.getNode(),
								`Invalid JSON in Restlet Body: ${(e as Error).message}. Value: ${bodyJson.substring(0, 100)}`,
								{ itemIndex: i },
							);
						}
					}

					responseData = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'netSuiteInvoqApi',
						requestOptions,
					)) as IDataObject;
				}

				if (Array.isArray(responseData)) {
					for (const item of responseData) {
						returnData.push(item);
					}
				} else if (responseData) {
					returnData.push(responseData);
				}
			} catch (error) {
				if (error instanceof NodeOperationError) {
					if (this.continueOnFail()) {
						returnData.push({ error: error.message });
						continue;
					}
					throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
				}

				const errorMessage = parseNetSuiteError(error);
				this.logger.error(`NetSuite error: ${errorMessage}`, { error });

				if (this.continueOnFail()) {
					returnData.push({ error: errorMessage });
					continue;
				}
				throw new NodeOperationError(this.getNode(), errorMessage, { itemIndex: i });
			}
		}

		return [this.helpers.returnJsonArray(returnData)];
	}
}
