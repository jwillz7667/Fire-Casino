"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Field, Input, Modal, useToast } from "@aureus/ui";
import { updateOperatorSchema } from "@aureus/shared";
import { api } from "@/lib/api";
import type { OperatorNode } from "@/lib/types";
import { errorMessage } from "@/lib/errors";

export function EditOperatorDialog({
  open,
  onClose,
  operator,
}: {
  open: boolean;
  onClose: () => void;
  operator: OperatorNode;
}): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(operator.displayName);
  const [buy, setBuy] = useState(operator.buyUnitPriceCents?.toString() ?? "");
  const [sell, setSell] = useState(operator.sellUnitPriceCents?.toString() ?? "");
  const [error, setError] = useState<string | undefined>();

  const mutation = useMutation({
    mutationFn: () => {
      const parsed = updateOperatorSchema.safeParse({
        displayName,
        buyUnitPriceCents: buy === "" ? null : Number(buy),
        sellUnitPriceCents: sell === "" ? null : Number(sell),
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
      return api.patch<OperatorNode>(`/operators/${operator.id}`, parsed.data);
    },
    onSuccess: () => {
      toast.push({ title: "Operator updated", intent: "success" });
      void queryClient.invalidateQueries({ queryKey: ["operator", operator.id] });
      void queryClient.invalidateQueries({ queryKey: ["operators"] });
      onClose();
    },
    onError: (err) => {
      setError(errorMessage(err));
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit operator"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => { setError(undefined); mutation.mutate(); }} loading={mutation.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Display name" required>
          <Input value={displayName} onChange={(e) => { setDisplayName(e.target.value); }} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Buy price ¢">
            <Input inputMode="numeric" value={buy} onChange={(e) => { setBuy(e.target.value.replace(/\D/g, "")); }} />
          </Field>
          <Field label="Sell price ¢">
            <Input inputMode="numeric" value={sell} onChange={(e) => { setSell(e.target.value.replace(/\D/g, "")); }} />
          </Field>
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}
