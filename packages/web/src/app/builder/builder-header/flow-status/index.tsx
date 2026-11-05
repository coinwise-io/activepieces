import { isNil, Permission } from '@activepieces/core-utils';
import { FlowVersionState } from '@activepieces/shared';
import React from 'react';

import { useBuilderStateContext } from '@/app/builder/builder-hooks';
import { FlowStatusToggle, FlowVersionStateDot } from '@/features/flows';
import { useAuthorization } from '@/hooks/authorization-hooks';

const BuilderFlowStatusSection = React.memo(() => {
  const [flowVersion, flow] = useBuilderStateContext((state) => [
    state.flowVersion,
    state.flow,
  ]);

  const { checkAccess } = useAuthorization();
  const canToggleFlowStatus = checkAccess(Permission.UPDATE_FLOW_STATUS);

  return (
    <div className="flex items-center space-x-2">
      <FlowVersionStateDot
        state={flowVersion.state}
        versionId={flowVersion.id}
        publishedVersionId={flow.publishedVersionId}
      ></FlowVersionStateDot>
      {canToggleFlowStatus &&
        (flow.publishedVersionId === flowVersion.id ||
          (flowVersion.state === FlowVersionState.DRAFT &&
            !isNil(flow.publishedVersionId))) && (
          <FlowStatusToggle flow={flow}></FlowStatusToggle>
        )}
    </div>
  );
});

BuilderFlowStatusSection.displayName = 'BuilderFlowStatusSection';
export { BuilderFlowStatusSection };
