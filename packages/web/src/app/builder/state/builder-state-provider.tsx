import { Permission } from '@activepieces/core-utils';
import { useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import {
  BuilderInitialState,
  BuilderStateContext,
  BuilderStore,
  createBuilderStore,
} from '@/app/builder/builder-hooks';
import { LoadingScreen } from '@/components/custom/loading-screen';
import { useSocket } from '@/components/providers/socket-provider';
import { projectHooks } from '@/features/projects';
import { FlowAccessProvider, useFlowAccess } from '@/hooks/authorization-hooks';

type BuilderStateProviderProps = Omit<
  React.PropsWithChildren<BuilderInitialState>,
  'socket' | 'queryClient'
>;

export function BuilderStateProvider({
  children,
  outputSampleData: sampleData,
  inputSampleData: sampleDataInput,
  ...props
}: BuilderStateProviderProps) {
  const storeRef = useRef<BuilderStore>(undefined);
  const { checkAccess, isLoading } = useFlowAccess(props.flow.id);
  const readonly = !checkAccess(Permission.WRITE_FLOW) || props.readonly;
  projectHooks.useReloadPageIfProjectIdChanged(props.flow.projectId);
  const socket = useSocket();
  const queryClient = useQueryClient();
  if (isLoading && !storeRef.current) {
    return <LoadingScreen mode="container" />;
  }
  if (!storeRef.current) {
    storeRef.current = createBuilderStore({
      ...props,
      readonly,
      outputSampleData: sampleData,
      inputSampleData: sampleDataInput,
      socket,
      queryClient,
    });
  }

  return (
    <FlowAccessProvider value={props.flow.id}>
      <BuilderStateContext.Provider value={storeRef.current}>
        {children}
      </BuilderStateContext.Provider>
    </FlowAccessProvider>
  );
}
