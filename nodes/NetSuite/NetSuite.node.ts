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

function normalizeAccountId(accountId: string): string {
	return accountId.toLowerCase().replace(/_/g, '-');
}

export class NetSuite implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'NetSuite',
		name: 'netSuite',
		icon: 'file:netsuite.png',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with NetSuite via REST API, SuiteQL, and Restlets using OAuth 2.0 Client Credentials',
		defaults: {
			name: 'NetSuite',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'netSuiteClientCredApi',
				required: true,
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
						action: 'Execute a SuiteQL query',
					},
				],
				default: 'execute',
			},

			// ----------------------------------
			//         Record Fields
			// ----------------------------------
			{
				displayName: 'Record Type',
				name: 'recordType',
				type: 'options',
				default: 'customer',
				typeOptions: {
					loadOptionsMethod: 'getRecordTypes',
				},
				description: 'The type of record to access. Choose from the list or enter a custom ID.',
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
				displayName: 'Fields',
				name: 'fields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['record'],
						operation: ['create', 'update'],
					},
				},
				options: [
					{
						displayName: 'JSON Fields',
						name: 'jsonFields',
						type: 'json',
						default: '{}',
						description: 'JSON object representing the fields to set on the record',
					},
				],
			},

		{
				displayName: 'Return All',
				name: 'recordReturnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all records or only the first page',
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
						operation: ['get', 'getAll'],
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
						description: 'Comma-separated list of field names to return (e.g. "id,companyname,email")',
					},
					{
						displayName: 'Query Filter',
						name: 'q',
						type: 'string',
						default: '',
						description: 'Filter expression for Get Many (e.g. "email IS NOT NULL")',
					},
				],
			},

			// ----------------------------------
			//         SuiteQL Fields
			// ----------------------------------
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				typeOptions: {
					rows: 5,
				},
				default: 'SELECT * FROM customer WHERE email IS NOT NULL',
				description: 'The SuiteQL query to execute',
				displayOptions: {
					show: {
						resource: ['suiteql'],
						operation: ['execute'],
					},
				},
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to the limit',
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
				default: 1000,
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

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: IDataObject[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const credentials = await this.getCredentials('netSuiteClientCredApi');
		const accountId = normalizeAccountId(credentials.accountId as string);
		const suiteTalkBase = `https://${accountId}.suitetalk.api.netsuite.com/services/rest`;
		const restletBase = `https://${accountId}.restlets.api.netsuite.com/app/site/hosting/restlet.nl`;

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: IDataObject | IDataObject[] | undefined;

				if (resource === 'record') {
					const recordType = this.getNodeParameter('recordType', i) as string;

					if (operation === 'get') {
						const recordId = this.getNodeParameter('recordId', i) as string;
						const additionalOptions = this.getNodeParameter('additionalOptions', i, {}) as IDataObject;
						const qs: IDataObject = {};
						if (additionalOptions.fields) qs.fields = additionalOptions.fields;
						if (additionalOptions.expandSubResources) qs.expandSubResources = 'true';

						responseData = (await this.helpers.httpRequestWithAuthentication.call(
							this,
							'netSuiteClientCredApi',
							{
								method: 'GET',
								url: `${suiteTalkBase}/record/v1/${recordType}/${recordId}`,
								qs,
							} as IHttpRequestOptions,
						)) as IDataObject;
					} else if (operation === 'getAll') {
						const recordReturnAll = this.getNodeParameter('recordReturnAll', i, false) as boolean;
						const recordLimit = recordReturnAll ? 1000 : (this.getNodeParameter('recordLimit', i, 1000) as number);
						const additionalOptions = this.getNodeParameter('additionalOptions', i, {}) as IDataObject;
						const qs: IDataObject = { limit: recordLimit };
						if (additionalOptions.fields) qs.fields = additionalOptions.fields;
						if (additionalOptions.expandSubResources) qs.expandSubResources = 'true';
						if (additionalOptions.q) qs.q = additionalOptions.q;

						const allRecords: IDataObject[] = [];
						let nextUrl: string | undefined = `${suiteTalkBase}/record/v1/${recordType}`;

						while (nextUrl) {
							const response = (await this.helpers.httpRequestWithAuthentication.call(
								this,
								'netSuiteClientCredApi',
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
						const body = JSON.parse(jsonFields) as IDataObject;
						responseData = (await this.helpers.httpRequestWithAuthentication.call(
							this,
							'netSuiteClientCredApi',
							{
								method: 'POST',
								url: `${suiteTalkBase}/record/v1/${recordType}`,
								body,
								headers: { 'Content-Type': 'application/json' },
							} as IHttpRequestOptions,
						)) as IDataObject;
					} else if (operation === 'update') {
						const recordId = this.getNodeParameter('recordId', i) as string;
						const jsonFields = this.getNodeParameter('fields.jsonFields', i, '{}') as string;
						const body = JSON.parse(jsonFields) as IDataObject;
						responseData = (await this.helpers.httpRequestWithAuthentication.call(
							this,
							'netSuiteClientCredApi',
							{
								method: 'PATCH',
								url: `${suiteTalkBase}/record/v1/${recordType}/${recordId}`,
								body,
								headers: { 'Content-Type': 'application/json' },
							} as IHttpRequestOptions,
						)) as IDataObject;
					} else if (operation === 'delete') {
						const recordId = this.getNodeParameter('recordId', i) as string;
						await this.helpers.httpRequestWithAuthentication.call(
							this,
							'netSuiteClientCredApi',
							{
								method: 'DELETE',
								url: `${suiteTalkBase}/record/v1/${recordType}/${recordId}`,
							} as IHttpRequestOptions,
						);
						responseData = { success: true, id: recordId };
					}
				} else if (resource === 'suiteql') {
					const query = this.getNodeParameter('query', i) as string;
					const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
					const limit = returnAll ? 1000 : (this.getNodeParameter('limit', i, 1000) as number);

					const allItems: IDataObject[] = [];
					let offset = 0;
					let hasMore = true;

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

						if (!returnAll || !response.hasMore) {
							hasMore = false;
						} else {
							offset += items.length;
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
						requestOptions.body = JSON.parse(bodyJson) as IDataObject;
					}

					responseData = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'netSuiteClientCredApi',
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
				let errorMessage = (error as Error).message;

				// Try to extract NetSuite structured error details from response body
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

				if (this.continueOnFail()) {
					returnData.push({ error: errorMessage });
					continue;
				}
				throw new Error(errorMessage);
			}
		}

		return [this.helpers.returnJsonArray(returnData)];
	}
}
