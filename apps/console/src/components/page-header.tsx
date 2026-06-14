import type { ReactElement, ReactNode } from "react";
import { cn } from "@aureus/ui";

/** Dense back-office page header: title, optional subtitle, right-aligned actions. */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold text-text-hi">{title}</h1>
        {subtitle ? <p className="text-sm text-text-mid">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
