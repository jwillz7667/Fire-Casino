"use client";

import type { ReactElement } from "react";
import type { OperatorSummary } from "@aureus/shared";
import { ModeBadge } from "@aureus/ui";
import { PLATFORM_MODE } from "@/lib/platform";
import { BalancePill } from "./balance-pill";
import { NotificationBell } from "./notification-bell";
import { AccountMenu } from "./account-menu";
import { GlobalSearch } from "./global-search";

export function Topbar({ principal }: { principal: OperatorSummary }): ReactElement {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-hairline bg-surface-1 px-4">
      <div className="flex flex-1 items-center gap-3">
        <ModeBadge mode={PLATFORM_MODE} />
        <GlobalSearch />
      </div>
      <div className="flex items-center gap-2">
        <BalancePill operatorId={principal.operatorId} />
        <NotificationBell />
        <AccountMenu />
      </div>
    </header>
  );
}
