"use client";

import { type ReactElement, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { createPlayerSchema } from "@aureus/shared";
import { Button, Field, Input, Modal, useToast } from "@aureus/ui";
import { api } from "@/lib/api";
import type { PlayerRow } from "@/lib/types";
import { errorMessage } from "@/lib/errors";
import { CopyButton } from "@/components/copy-button";

function generatePassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function CreatePlayerDialog({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [tempPassword, setTempPassword] = useState(generatePassword);
  const [error, setError] = useState<string | undefined>();
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);

  function reset(): void {
    setUsername("");
    setDisplayName("");
    setTempPassword(generatePassword());
    setError(undefined);
    setCreated(null);
  }

  const mutation = useMutation({
    mutationFn: () => {
      const parsed = createPlayerSchema.safeParse({
        username,
        tempPassword,
        displayName: displayName === "" ? undefined : displayName,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid player details");
      return api.post<PlayerRow>("/players", parsed.data);
    },
    onSuccess: () => {
      setCreated({ username, password: tempPassword });
      void queryClient.invalidateQueries({ queryKey: ["players"] });
      toast.push({ title: "Player created", intent: "success" });
    },
    onError: (err) => {
      setError(errorMessage(err));
    },
  });

  function close(): void {
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={created ? "Player created" : "Create player"}
      footer={
        created ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button onClick={() => { setError(undefined); mutation.mutate(); }} loading={mutation.isPending}>
              Create player
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-mid">Give the player these credentials. They change the password on first login.</p>
          <div className="flex flex-col gap-2 rounded-md border border-hairline bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-text-lo">Username</span>
              <div className="flex items-center gap-2">
                <code className="text-sm text-text-hi">{created.username}</code>
                <CopyButton value={created.username} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-text-lo">Temp password</span>
              <div className="flex items-center gap-2">
                <code className="font-mono text-sm text-gold-light">{created.password}</code>
                <CopyButton value={created.password} />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Username" required>
            <Input value={username} onChange={(e) => { setUsername(e.target.value); }} autoComplete="off" />
          </Field>
          <Field label="Display name" hint="Optional">
            <Input value={displayName} onChange={(e) => { setDisplayName(e.target.value); }} />
          </Field>
          <Field label="Temporary password" required>
            <div className="flex gap-2">
              <Input value={tempPassword} onChange={(e) => { setTempPassword(e.target.value); }} className="font-mono" />
              <Button variant="secondary" type="button" onClick={() => { setTempPassword(generatePassword()); }}>
                <RefreshCw className="h-4 w-4" />
                New
              </Button>
            </div>
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>
      )}
    </Modal>
  );
}
