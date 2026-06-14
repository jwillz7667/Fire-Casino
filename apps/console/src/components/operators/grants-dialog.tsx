"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  canGrantPermission,
  GRANTABLE_PERMISSIONS,
  type GrantablePermission,
} from "@aureus/shared";
import { Button, Checkbox, Modal, useToast } from "@aureus/ui";
import { api } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import type { SetGrantsResult } from "@/lib/types";
import { errorMessage } from "@/lib/errors";
import { humanize } from "@/lib/format";

/**
 * Confer per-operator permission grants on a descendant (docs/04 §3). Only
 * grants the caller can actually confer are offered; the API is authoritative.
 */
export function GrantsDialog({
  open,
  onClose,
  operatorId,
  current,
}: {
  open: boolean;
  onClose: () => void;
  operatorId: string;
  current: string[];
}): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const principal = usePrincipal();
  const [selected, setSelected] = useState<Set<string>>(new Set(current));

  const grantable = GRANTABLE_PERMISSIONS.filter(
    (perm) => canGrantPermission({ tier: principal.tier, settings: { permissions: principal.permissions } }, perm).allowed,
  );

  const mutation = useMutation({
    mutationFn: () =>
      api.put<SetGrantsResult>(`/operators/${operatorId}/grants`, {
        permissions: [...selected].filter((p): p is GrantablePermission =>
          (GRANTABLE_PERMISSIONS as readonly string[]).includes(p),
        ),
      }),
    onSuccess: () => {
      toast.push({ title: "Grants updated", intent: "success" });
      void queryClient.invalidateQueries({ queryKey: ["operator", operatorId] });
      onClose();
    },
    onError: (err) => {
      toast.push({ title: "Couldn't update grants", description: errorMessage(err), intent: "danger" });
    },
  });

  function toggle(perm: string, next: boolean): void {
    setSelected((prev) => {
      const set = new Set(prev);
      if (next) set.add(perm);
      else set.delete(perm);
      return set;
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Permission grants"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => { mutation.mutate(); }} loading={mutation.isPending}>
            Save grants
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-text-mid">
        Grants you confer flow downward only and can never exceed your own abilities.
      </p>
      <div className="flex flex-col gap-2.5">
        {grantable.length === 0 ? (
          <p className="text-sm text-text-lo">You have no grantable permissions to confer.</p>
        ) : (
          grantable.map((perm) => (
            <Checkbox
              key={perm}
              checked={selected.has(perm)}
              onChange={(next) => { toggle(perm, next); }}
              label={
                <span className="flex flex-col">
                  <span className="text-sm text-text-hi">{humanize(perm.replace(".", " "))}</span>
                  <span className="font-mono text-[0.6875rem] text-text-lo">{perm}</span>
                </span>
              }
            />
          ))
        )}
      </div>
    </Modal>
  );
}
