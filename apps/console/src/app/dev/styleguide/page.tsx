"use client";

import { type ReactElement, type ReactNode, useState } from "react";
import {
  Badge,
  BalanceChip,
  Button,
  Card,
  Checkbox,
  CoinMark,
  CoinSpinner,
  type Column,
  ConfirmMoneyDialog,
  DataTable,
  Drawer,
  EmptyState,
  Field,
  ForbiddenState,
  IconButton,
  Input,
  type Intent,
  KpiStat,
  ModeBadge,
  Modal,
  Money,
  MoneyInput,
  Panel,
  ReasonDialog,
  RegionBlockedState,
  ScopeIndicator,
  SearchInput,
  SectionTitle,
  SegmentedControl,
  Select,
  Skeleton,
  StatusPill,
  Tabs,
  Textarea,
  Toggle,
  useToast,
} from "@aureus/ui";
import { Bell, Settings } from "lucide-react";

interface DemoRow {
  id: string;
  name: string;
  amountMinor: string;
  status: string;
}

const DEMO_ROWS: DemoRow[] = [
  { id: "1", name: "North Distributor", amountMinor: "1250000", status: "ACTIVE" },
  { id: "2", name: "Harbor Store", amountMinor: "48000", status: "SUSPENDED" },
  { id: "3", name: "Pier 9 Agent", amountMinor: "0", status: "PENDING" },
];

const INTENTS: Intent[] = ["neutral", "success", "warning", "danger", "info", "gold", "ember"];

export default function StyleguidePage(): ReactElement {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [toggle, setToggle] = useState(true);
  const [checkbox, setCheckbox] = useState(false);
  const [amount, setAmount] = useState<bigint | undefined>(125000n);
  const [tab, setTab] = useState("a");
  const [segment, setSegment] = useState("one");
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);

  const columns: Column<DemoRow>[] = [
    { key: "name", header: "Name", render: (r) => r.name },
    { key: "amount", header: "Balance", numeric: true, render: (r) => <Money valueMinor={r.amountMinor} currency="CREDIT" size="sm" /> },
    { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} /> },
  ];

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-10">
      <header className="flex items-center gap-3">
        <CoinMark size="lg" glow />
        <div>
          <h1 className="font-display text-3xl font-semibold text-text-hi">Design system</h1>
          <p className="text-sm text-text-mid">Every @aureus/ui primitive in the console theme.</p>
        </div>
      </header>

      <Section title="Money">
        <div className="flex flex-wrap items-center gap-6">
          <Money valueMinor="1250000" currency="CREDIT" size="xl" />
          <Money valueMinor="48000" currency="PRIZE" size="lg" />
          <Money valueMinor="-12500" currency="CREDIT" signed />
          <Money valueMinor="12500" currency="CREDIT" signed />
          <BalanceChip balances={[{ currency: "PLAY", valueMinor: "500000", label: "PLAY" }, { currency: "PRIZE", valueMinor: "125000", label: "PRIZE" }]} />
          <div className="flex items-center gap-2">
            <CoinMark variant="gold" glow />
            <CoinMark variant="ember" />
            <CoinMark spin />
          </div>
        </div>
        <div className="max-w-xs">
          <Field label="Money input">
            <MoneyInput valueMinor={amount} onChangeMinor={setAmount} currency="CREDIT" />
          </Field>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <IconButton label="Bell"><Bell className="h-5 w-5" /></IconButton>
          <IconButton label="Settings"><Settings className="h-5 w-5" /></IconButton>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Text input" hint="A helpful hint">
            <Input placeholder="Type here…" />
          </Field>
          <Field label="With error" error="This field is required">
            <Input placeholder="Invalid" />
          </Field>
          <Field label="Select">
            <Select>
              <option>Option one</option>
              <option>Option two</option>
            </Select>
          </Field>
          <Field label="Search">
            <SearchInput value={search} onChange={setSearch} />
          </Field>
          <Field label="Textarea" className="sm:col-span-2">
            <Textarea placeholder="Longer text…" />
          </Field>
        </div>
        <div className="flex items-center gap-6">
          <Toggle checked={toggle} onChange={setToggle} label="Toggle" />
          <Checkbox checked={checkbox} onChange={setCheckbox} label="Checkbox" />
        </div>
      </Section>

      <Section title="Badges & status">
        <div className="flex flex-wrap gap-2">
          {INTENTS.map((intent) => (
            <Badge key={intent} intent={intent}>
              {intent}
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {["ACTIVE", "PENDING", "SUSPENDED", "APPROVED", "PAID", "REJECTED", "CANCELLED"].map((s) => (
            <StatusPill key={s} status={s} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ModeBadge mode="OPERATOR" />
          <ModeBadge mode="COMPLIANCE" />
          <ScopeIndicator displayName="Harbor Store" tier="STORE" />
        </div>
      </Section>

      <Section title="KPIs & surfaces">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiStat label="Circulation" valueMinor="125000000" currency="CREDIT" />
          <KpiStat label="Active players" value="1,284" hint="Subtree" />
          <KpiStat label="Net today" valueMinor="3400000" currency="CREDIT" />
          <KpiStat label="Pending" value="7" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card className="p-4">
            <SectionTitle>Card</SectionTitle>
            <p className="mt-2 text-sm text-text-mid">A token-driven surface with a lit top edge.</p>
          </Card>
          <Panel>
            <SectionTitle>Panel</SectionTitle>
            <p className="mt-2 text-sm text-text-mid">A padded card.</p>
          </Panel>
        </div>
      </Section>

      <Section title="Loading & empty">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
            <CoinSpinner label="Loading…" />
          </div>
          <Card className="p-4">
            <EmptyState title="Nothing here" description="An empty state with a call to action." action={<Button size="sm">Add one</Button>} />
          </Card>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card className="p-4"><ForbiddenState /></Card>
          <Card className="p-4"><RegionBlockedState /></Card>
        </div>
      </Section>

      <Section title="Navigation">
        <Tabs active={tab} onChange={setTab} items={[{ key: "a", label: "Overview" }, { key: "b", label: "Activity", badge: <Badge intent="ember">3</Badge> }, { key: "c", label: "Settings" }]} />
        <SegmentedControl active={segment} onChange={setSegment} items={[{ key: "one", label: "One" }, { key: "two", label: "Two" }, { key: "three", label: "Three" }]} />
      </Section>

      <Section title="Data table">
        <DataTable columns={columns} rows={DEMO_ROWS} getRowId={(r) => r.id} rowActions={() => <Button size="sm" variant="ghost">Action</Button>} />
      </Section>

      <Section title="Overlays & toasts">
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => { setModalOpen(true); }}>Open modal</Button>
          <Button variant="secondary" onClick={() => { setDrawerOpen(true); }}>Open drawer</Button>
          <Button variant="secondary" onClick={() => { setConfirmOpen(true); }}>Confirm money</Button>
          <Button variant="secondary" onClick={() => { setReasonOpen(true); }}>Reason dialog</Button>
          <Button variant="ghost" onClick={() => { toast.push({ title: "Saved", description: "Your change was applied.", intent: "success" }); }}>
            Push toast
          </Button>
        </div>
      </Section>

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); }} title="Example modal" footer={<Button onClick={() => { setModalOpen(false); }}>Done</Button>}>
        <p className="text-sm text-text-mid">Modal body content goes here.</p>
      </Modal>

      <Drawer open={drawerOpen} onClose={() => { setDrawerOpen(false); }} title="Example drawer">
        <p className="text-sm text-text-mid">Drawer body content goes here.</p>
      </Drawer>

      <ConfirmMoneyDialog
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false); }}
        onConfirm={() => { setConfirmOpen(false); }}
        title="Confirm transfer"
        deltas={[{ label: "Your balance", currency: "CREDIT", beforeMinor: "1250000", afterMinor: "1125000" }, { label: "Recipient", currency: "CREDIT", beforeMinor: "0", afterMinor: "125000" }]}
      />

      <ReasonDialog open={reasonOpen} onClose={() => { setReasonOpen(false); }} onConfirm={() => { setReasonOpen(false); }} title="Reject with reason" danger />
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="border-b border-hairline pb-2 font-display text-lg font-medium text-text-hi">{title}</h2>
      {children}
    </section>
  );
}
