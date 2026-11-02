import { SCIM_CUSTOM_USER_ATTRIBUTES_SCHEMA, SCIM_GROUP_SCHEMA, SCIM_LIST_RESPONSE_SCHEMA, SCIM_RESOURCE_TYPE_SCHEMA, SCIM_SCHEMA_SCHEMA, SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA, SCIM_USER_SCHEMA } from '@activepieces/shared'

function serviceProviderConfig({ baseUrl }: { baseUrl: string }): Record<string, unknown> {
    return {
        schemas: [SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA],
        patch: { supported: true },
        bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
        filter: { supported: true, maxResults: 200 },
        changePassword: { supported: false },
        sort: { supported: false },
        etag: { supported: false },
        authenticationSchemes: [
            {
                type: 'oauthbearertoken',
                name: 'OAuth Bearer Token',
                description: 'Authentication with a SCIM token sent as a bearer token',
                specUri: 'https://www.rfc-editor.org/info/rfc6750',
                primary: true,
            },
        ],
        meta: {
            resourceType: 'ServiceProviderConfig',
            location: `${baseUrl}ServiceProviderConfig`,
        },
    }
}

function resourceTypes({ baseUrl }: { baseUrl: string }): Record<string, unknown> {
    const resources = [
        {
            schemas: [SCIM_RESOURCE_TYPE_SCHEMA],
            id: 'User',
            name: 'User',
            endpoint: '/Users',
            description: 'User account',
            schema: SCIM_USER_SCHEMA,
            schemaExtensions: [{ schema: SCIM_CUSTOM_USER_ATTRIBUTES_SCHEMA, required: false }],
            meta: { resourceType: 'ResourceType', location: `${baseUrl}ResourceTypes/User` },
        },
        {
            schemas: [SCIM_RESOURCE_TYPE_SCHEMA],
            id: 'Group',
            name: 'Group',
            endpoint: '/Groups',
            description: 'Group of users',
            schema: SCIM_GROUP_SCHEMA,
            meta: { resourceType: 'ResourceType', location: `${baseUrl}ResourceTypes/Group` },
        },
    ]
    return listOf({ resources })
}

function schemas({ baseUrl }: { baseUrl: string }): Record<string, unknown> {
    const resources = [
        {
            schemas: [SCIM_SCHEMA_SCHEMA],
            id: SCIM_USER_SCHEMA,
            name: 'User',
            description: 'User account',
            attributes: [
                attribute({ name: 'userName', type: 'string', required: true, uniqueness: 'server' }),
                attribute({ name: 'externalId', type: 'string' }),
                attribute({ name: 'active', type: 'boolean' }),
                {
                    ...attribute({ name: 'name', type: 'complex' }),
                    subAttributes: [
                        attribute({ name: 'givenName', type: 'string' }),
                        attribute({ name: 'familyName', type: 'string' }),
                        attribute({ name: 'formatted', type: 'string' }),
                    ],
                },
                {
                    ...attribute({ name: 'emails', type: 'complex', multiValued: true }),
                    subAttributes: [
                        attribute({ name: 'value', type: 'string' }),
                        attribute({ name: 'type', type: 'string' }),
                        attribute({ name: 'primary', type: 'boolean' }),
                    ],
                },
            ],
            meta: { resourceType: 'Schema', location: `${baseUrl}Schemas/${SCIM_USER_SCHEMA}` },
        },
        {
            schemas: [SCIM_SCHEMA_SCHEMA],
            id: SCIM_GROUP_SCHEMA,
            name: 'Group',
            description: 'Group of users',
            attributes: [
                attribute({ name: 'displayName', type: 'string', required: true, uniqueness: 'server' }),
                attribute({ name: 'externalId', type: 'string' }),
                {
                    ...attribute({ name: 'members', type: 'complex', multiValued: true }),
                    subAttributes: [attribute({ name: 'value', type: 'string' })],
                },
            ],
            meta: { resourceType: 'Schema', location: `${baseUrl}Schemas/${SCIM_GROUP_SCHEMA}` },
        },
    ]
    return listOf({ resources })
}

function listOf({ resources }: { resources: Record<string, unknown>[] }): Record<string, unknown> {
    return {
        schemas: [SCIM_LIST_RESPONSE_SCHEMA],
        totalResults: resources.length,
        startIndex: 1,
        itemsPerPage: resources.length,
        Resources: resources,
    }
}

function attribute({ name, type, required, multiValued, uniqueness }: AttributeParams): Record<string, unknown> {
    return {
        name,
        type,
        multiValued: multiValued ?? false,
        required: required ?? false,
        caseExact: false,
        mutability: 'readWrite',
        returned: 'default',
        uniqueness: uniqueness ?? 'none',
    }
}

export const scimDiscovery = {
    serviceProviderConfig,
    resourceTypes,
    schemas,
}

type AttributeParams = {
    name: string
    type: string
    required?: boolean
    multiValued?: boolean
    uniqueness?: string
}
