"use client";

import { type ReactElement, useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { operatorTierSchema, platformModeSchema } from "@aureus/shared";
import {
  Badge,
  Button,
  Field,
  ForbiddenState,
  Input,
  MoneyInput,
  Panel,
  SectionTitle,
  Select,
  Toggle,
  useToast,
} from "@aureus/ui";
import { api } from "@/lib/api";
import { usePrincipal } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import { PLATFORM_MODE } from "@/lib/platform";
import { errorMessage } from "@/lib/errors";
import { humanize } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";

type Funding = "AGENT_FUNDED" | "UPLINE_REIMBURSED";

interface RedemptionApproval {
  thresholdMinor?: string | number;
  approverTier?: string;
  funding?: Funding;
}

interface NodeSettings {
  displayName?: string;
  buyUnitPriceCents?: number;
  sellUnitPriceCents?: number;
  prizeBonusBps?: number;
  redemptionApproval?: RedemptionApproval | null;
}

/** Flat payload sent on PUT /settings/platform (UpdatePlatformSettingsInput-shaped). */
interface PlatformSettingsUpdate {
  PLATFORM_MODE?: "OPERATOR" | "COMPLIANCE";
  REDEMPTION_KYC_THRESHOLD_MINOR?: number;
  DEFAULT_GAME_RTP_BPS?: number;
  KYC_ENFORCED?: boolean;
  GEO_ENFORCED?: boolean;
}

/** Real GET /settings/platform shape (settings.service.getPlatform). */
interface PlatformSettingRow {
  key: string;
  value: unknown;
  readOnly: boolean;
  updatedAt: string | null;
}
interface PlatformSettingsResponse {
  mode: "OPERATOR" | "COMPLIANCE";
  settings: PlatformSettingRow[];
}

function settingNumber(rows: PlatformSettingRow[], key: string): string {
  const v = rows.find((r) => r.key === key)?.value;
  return typeof v === "number" || typeof v === "string" ? String(v) : "";
}
function settingBool(rows: PlatformSettingRow[], key: string, fallback: boolean): boolean {
  const v = rows.find((r) => r.key === key)?.value;
  return typeof v === "boolean" ? v : fallback;
}
function settingString(rows: PlatformSettingRow[], key: string): string {
  const v = rows.find((r) => r.key === key)?.value;
  return v === null || v === undefined ? "—" : String(v);
}

export default function SettingsPage(): ReactElement {
  const principal = usePrincipal();
  const canNode = hasPermission(principal, "settings.manage");
  const canPlatform = hasPermission(principal, "platform.settings");

  if (!canNode && !canPlatform) return <ForbiddenState />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" subtitle="Your node configuration and, for super admins, platform settings." />
      {canNode ? <NodeSettingsPanel /> : null}
      {canPlatform ? <PlatformSettingsPanel /> : null}
    </div>
  );
}

function NodeSettingsPanel(): ReactElement {
  const toast = useToast();
  const [displayName, setDisplayName] = useState("");
  const [buy, setBuy] = useState("");
  const [sell, setSell] = useState("");
  const [prizeBonusBps, setPrizeBonusBps] = useState("");
  // Redemption-approval routing (docs/04 §3). An empty approver tier means
  // "not routed" and the whole block is omitted from the payload.
  const [approverTier, setApproverTier] = useState("");
  const [funding, setFunding] = useState<Funding>("AGENT_FUNDED");
  const [threshold, setThreshold] = useState<bigint | undefined>(undefined);

  const settings = useQuery({
    queryKey: ["settings", "node"],
    queryFn: () => api.get<NodeSettings>("/settings/node"),
    retry: false,
  });

  useEffect(() => {
    const data = settings.data;
    if (!data) return;
    setDisplayName(data.displayName ?? "");
    setBuy(data.buyUnitPriceCents?.toString() ?? "");
    setSell(data.sellUnitPriceCents?.toString() ?? "");
    setPrizeBonusBps(data.prizeBonusBps?.toString() ?? "");
    const ra = data.redemptionApproval;
    setApproverTier(ra?.approverTier ?? "");
    setFunding(ra?.funding ?? "AGENT_FUNDED");
    setThreshold(ra?.thresholdMinor !== undefined && ra.thresholdMinor !== null ? BigInt(ra.thresholdMinor) : undefined);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      api.put<NodeSettings>("/settings/node", {
        displayName: displayName === "" ? undefined : displayName,
        buyUnitPriceCents: buy === "" ? undefined : Number(buy),
        sellUnitPriceCents: sell === "" ? undefined : Number(sell),
        prizeBonusBps: prizeBonusBps === "" ? undefined : Number(prizeBonusBps),
        redemptionApproval:
          approverTier === ""
            ? undefined
            : {
                approverTier,
                funding,
                thresholdMinor: threshold !== undefined ? threshold.toString() : undefined,
              },
      }),
    onSuccess: () => {
      toast.push({ title: "Node settings saved", intent: "success" });
      void settings.refetch();
    },
    onError: (err) => {
      toast.push({ title: "Save failed", description: errorMessage(err), intent: "danger" });
    },
  });

  return (
    <Panel className="flex flex-col gap-4">
      <SectionTitle>Node settings</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Display name">
          <Input value={displayName} onChange={(e) => { setDisplayName(e.target.value); }} />
        </Field>
        <Field label="Default prize bonus (bps)" hint="Compliance mode PRIZE bonus on recharge">
          <Input inputMode="numeric" value={prizeBonusBps} onChange={(e) => { setPrizeBonusBps(e.target.value.replace(/\D/g, "")); }} />
        </Field>
        <Field label="Buy price ¢">
          <Input inputMode="numeric" value={buy} onChange={(e) => { setBuy(e.target.value.replace(/\D/g, "")); }} />
        </Field>
        <Field label="Sell price ¢">
          <Input inputMode="numeric" value={sell} onChange={(e) => { setSell(e.target.value.replace(/\D/g, "")); }} />
        </Field>
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-hairline bg-surface-2 p-3">
        <span className="text-xs font-medium uppercase tracking-wide text-text-mid">Redemption routing</span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Approver tier" hint="Who signs off; blank = not routed">
            <Select value={approverTier} onChange={(e) => { setApproverTier(e.target.value); }}>
              <option value="">Not routed</option>
              {operatorTierSchema.options.map((t) => (
                <option key={t} value={t}>{humanize(t)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Approval threshold" hint="At/above this needs approval">
            <MoneyInput valueMinor={threshold} onChangeMinor={setThreshold} />
          </Field>
          <Field label="Funding">
            <Select value={funding} onChange={(e) => { setFunding(e.target.value as Funding); }} disabled={approverTier === ""}>
              <option value="AGENT_FUNDED">Agent funded</option>
              <option value="UPLINE_REIMBURSED">Upline reimbursed</option>
            </Select>
          </Field>
        </div>
      </div>

      <div>
        <Button onClick={() => { save.mutate(); }} loading={save.isPending}>
          Save node settings
        </Button>
      </div>
    </Panel>
  );
}

function PlatformSettingsPanel(): ReactElement {
  const toast = useToast();
  const [mode, setMode] = useState<"OPERATOR" | "COMPLIANCE">(PLATFORM_MODE);
  const [rtp, setRtp] = useState("");
  const [kycThreshold, setKycThreshold] = useState("");
  const [kycEnforced, setKycEnforced] = useState(true);
  const [geoEnforced, setGeoEnforced] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [initialMode, setInitialMode] = useState<"OPERATOR" | "COMPLIANCE">(PLATFORM_MODE);
  const [creditMinorUnits, setCreditMinorUnits] = useState("—");

  const settings = useQuery({
    queryKey: ["settings", "platform"],
    queryFn: () => api.get<PlatformSettingsResponse>("/settings/platform"),
    retry: false,
  });

  useEffect(() => {
    const data = settings.data;
    if (!data) return;
    // Seed BOTH mode and initialMode from the server's authoritative mode so a
    // save can never clobber PLATFORM_MODE or skip the hard-confirm (CA2).
    setMode(data.mode);
    setInitialMode(data.mode);
    setRtp(settingNumber(data.settings, "DEFAULT_GAME_RTP_BPS"));
    setKycThreshold(settingNumber(data.settings, "REDEMPTION_KYC_THRESHOLD_MINOR"));
    setKycEnforced(settingBool(data.settings, "KYC_ENFORCED", true));
    setGeoEnforced(settingBool(data.settings, "GEO_ENFORCED", true));
    setCreditMinorUnits(settingString(data.settings, "CREDIT_MINOR_UNITS"));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      api.put<PlatformSettingsResponse>("/settings/platform", {
        PLATFORM_MODE: mode,
        DEFAULT_GAME_RTP_BPS: rtp === "" ? undefined : Number(rtp),
        REDEMPTION_KYC_THRESHOLD_MINOR: kycThreshold === "" ? undefined : Number(kycThreshold),
        KYC_ENFORCED: kycEnforced,
        GEO_ENFORCED: geoEnforced,
      } satisfies PlatformSettingsUpdate),
    onSuccess: () => {
      toast.push({ title: "Platform settings saved", intent: "success" });
      setInitialMode(mode);
      setConfirmOpen(false);
      void settings.refetch();
    },
    onError: (err) => {
      toast.push({ title: "Save failed", description: errorMessage(err), intent: "danger" });
      setConfirmOpen(false);
    },
  });

  const modeChanged = mode !== initialMode;

  function attemptSave(): void {
    if (modeChanged) setConfirmOpen(true);
    else save.mutate();
  }

  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <SectionTitle>Platform settings</SectionTitle>
        <Badge intent="warning">Super admin</Badge>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Platform mode" hint="Changing this alters the money & compliance model">
          <Select value={mode} onChange={(e) => { setMode(e.target.value as "OPERATOR" | "COMPLIANCE"); }}>
            {platformModeSchema.options.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Default game RTP (bps)" hint="1–10000">
          <Input inputMode="numeric" value={rtp} onChange={(e) => { setRtp(e.target.value.replace(/\D/g, "")); }} />
        </Field>
        <Field label="Redemption KYC threshold (minor units)">
          <Input inputMode="numeric" value={kycThreshold} onChange={(e) => { setKycThreshold(e.target.value.replace(/\D/g, "")); }} />
        </Field>
        <Field label="Credit minor units" hint="Money scale — fixed for the life of the deployment">
          <Input value={creditMinorUnits} readOnly disabled />
        </Field>
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-hairline bg-surface-2 p-3">
        <Toggle checked={kycEnforced} onChange={setKycEnforced} label="Enforce KYC at redemption" />
        <Toggle checked={geoEnforced} onChange={setGeoEnforced} label="Enforce geo rules at login & redemption" />
      </div>

      <div>
        <Button onClick={attemptSave} loading={save.isPending}>
          Save platform settings
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false); }}
        onConfirm={() => { save.mutate(); }}
        title="Change platform mode?"
        description={`Switching from ${initialMode} to ${mode} changes the money model and which compliance toggles apply. This is a significant change — confirm you intend it.`}
        confirmLabel={`Switch to ${mode}`}
        danger
        loading={save.isPending}
      />
    </Panel>
  );
}
