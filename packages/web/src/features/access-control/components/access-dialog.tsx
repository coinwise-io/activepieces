import { AccessTarget } from '@activepieces/shared';
import { t } from 'i18next';
import { ShieldCheck } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { accessControlHooks } from '@/hooks/access-control-hooks';

import { AccessPanel } from './access-panel';

export function AccessDialog({
  open,
  onOpenChange,
  target,
  entityName,
}: AccessDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('Access')}</DialogTitle>
          <DialogDescription>
            {t('Choose who can see, run or change {name}.', {
              name: entityName,
            })}
          </DialogDescription>
        </DialogHeader>
        {open && <AccessPanel key={targetKey(target)} target={target} />}
      </DialogContent>
    </Dialog>
  );
}

export function AccessMenuItem({ target, onOpen }: AccessMenuItemProps) {
  const { data: effective } = accessControlHooks.useEffectiveAccess({
    request: {
      projectId: target.projectId,
      folderId: target.folderId,
      flowId: target.flowId,
    },
    enabled: true,
  });
  if (!effective?.canManageAccess) {
    return null;
  }
  return (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen();
      }}
    >
      <div className="flex cursor-pointer flex-row items-center gap-2">
        <ShieldCheck className="h-4 w-4" />
        <span>{t('Access')}</span>
      </div>
    </DropdownMenuItem>
  );
}

function targetKey(target: AccessTarget): string {
  return [target.projectId, target.folderId, target.flowId].join(':');
}

type AccessDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: AccessTarget;
  entityName: string;
};

type AccessMenuItemProps = {
  target: AccessTarget;
  onOpen: () => void;
};
