
import {
    ListTriggerEventsRequest,
    PrincipalType,
    SaveTriggerEventRequest,
} from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { accessGuard } from '../../access-control/access-guard'
import { ProjectResourceType } from '../../core/security/authorization/common'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { flowService } from '../../flows/flow/flow.service'
import { triggerEventService } from './trigger-event.service'

const DEFAULT_PAGE_SIZE = 10

export const triggerEventController: FastifyPluginAsyncZod = async (fastify) => {


    fastify.post('/', SaveTriggerEventRequestParams, async (request) => {
        const guard = accessGuard(request.log)
        await guard.assertFlowById({ access: await guard.forRequest({ request }), projectId: request.projectId, flowId: request.body.flowId, capability: 'EDIT' })
        return triggerEventService(request.log).saveEvent({
            projectId: request.projectId,
            flowId: request.body.flowId,
            payload: request.body.mockData,
        })
    })

    fastify.get('/', ListTriggerEventsRequestParams, async (request) => {
        const flow = await flowService(request.log).getOnePopulatedOrThrow({
            id: request.query.flowId,
            projectId: request.projectId,
        })
        const guard = accessGuard(request.log)
        guard.assertFlow({ access: await guard.forRequest({ request }), projectId: request.projectId, flow: { id: flow.id, folderId: flow.folderId ?? null }, capability: 'READ_RUNS' })

        return triggerEventService(request.log).list({
            projectId: request.projectId,
            flow,
            cursor: request.query.cursor ?? null,
            limit: request.query.limit ?? DEFAULT_PAGE_SIZE,
        })
    },
    )
}


const ListTriggerEventsRequestParams = {
    schema: {
        querystring: ListTriggerEventsRequest,
    },
    config: {
        security: securityAccess.project([PrincipalType.USER], undefined, {
            type: ProjectResourceType.QUERY,
        }),
    },
}

const SaveTriggerEventRequestParams = {
    schema: {
        body: SaveTriggerEventRequest,
    },
    config: {
        security: securityAccess.project([PrincipalType.USER], undefined, {
            type: ProjectResourceType.BODY,
        }),
    },
}