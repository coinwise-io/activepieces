import { isManualPieceTrigger, isNil } from '@activepieces/core-utils'
import { FlowActionType, FlowRun, flowStructureUtil, FlowTriggerType, FlowVersion, isFailedState, isFlowRunStateTerminal, RunEnvironment, WebsocketClientEvent } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { websocketService } from '../../core/websockets.service'
import { flowVersionService } from '../flow-version/flow-version.service'

export const flowRunHooks = (log: FastifyBaseLogger) => ({
    async onFinish(flowRun: FlowRun): Promise<void> {
        if (!isFlowRunStateTerminal({
            status: flowRun.status,
            ignoreInternalError: true,
        })) {
            return
        }
        const flowVersion = await flowVersionService(log).getOne(flowRun.flowVersionId)
        const isPieceTrigger = !isNil(flowVersion) && flowVersion.trigger.type === FlowTriggerType.PIECE && !isNil(flowVersion.trigger.settings.triggerName) 
        const isManualTrigger = isPieceTrigger && isManualPieceTrigger({ pieceName: flowVersion.trigger.settings.pieceName, triggerName: flowVersion.trigger.settings.triggerName })
        if (flowRun.environment === RunEnvironment.TESTING || isManualTrigger) {
            websocketService.toRunViewers({ projectId: flowRun.projectId, triggeredBy: flowRun.triggeredBy }).emit(WebsocketClientEvent.UPDATE_RUN_PROGRESS, {
                flowRun,
            })
        }
        if (isFailedState(flowRun.status) && flowRun.environment === RunEnvironment.PRODUCTION && !isNil(flowRun.failedStep)) {
            logFailedCodeStep({ log, flowRun, flowVersion })
        }
    },
})

function logFailedCodeStep({ log, flowRun, flowVersion }: LogFailedCodeStepParams): void {
    if (isNil(flowVersion) || isNil(flowRun.failedStep)) {
        return
    }
    const failedStep = flowStructureUtil.getStep(flowRun.failedStep.name, flowVersion.trigger)
    if (isNil(failedStep) || failedStep.type !== FlowActionType.CODE) {
        return
    }
    log.warn({
        flowRun: { id: flowRun.id, status: flowRun.status, environment: flowRun.environment },
        flow: { id: flowRun.flowId },
        flowVersion: { id: flowRun.flowVersionId },
        project: { id: flowRun.projectId },
        step: { name: flowRun.failedStep.name },
        codeRuntime: failedStep.settings.useDeno !== false ? 'deno' : 'legacy',
        error: flowRun.failedStep.message,
    }, 'Code step failed')
}

type LogFailedCodeStepParams = {
    log: FastifyBaseLogger
    flowRun: FlowRun
    flowVersion: FlowVersion | null
}
