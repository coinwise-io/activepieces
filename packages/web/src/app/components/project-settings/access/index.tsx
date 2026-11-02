import { t } from 'i18next';

import { AccessPanel } from '@/features/access-control';

export function AccessSettings({ projectId }: { projectId: string }) {
  return (
    <div className="flex flex-col gap-4 pb-6">
      <p className="text-sm text-gray-11">
        {t(
          'Choose who can see, run or change the flows of this project. Access given here covers every folder and flow in it.',
        )}
      </p>
      <AccessPanel target={{ projectId }} />
    </div>
  );
}
