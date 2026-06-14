import { Injectable } from "@nestjs/common";
import { ClsService, type ClsStore } from "nestjs-cls";
import { type ScopeContext } from "@aureus/shared";

export interface AppClsStore extends ClsStore {
  scope?: ScopeContext;
  requestId?: string;
}

/**
 * Typed accessor for the per-request scope held in AsyncLocalStorage (nestjs-cls).
 * The AuthGuard resolves and sets the scope after authentication; the scoped
 * Prisma client and the ScopeGuard read it. Never trust scope from the JWT.
 */
@Injectable()
export class ScopeService {
  constructor(private readonly cls: ClsService<AppClsStore>) {}

  set(scope: ScopeContext): void {
    this.cls.set("scope", scope);
  }

  get(): ScopeContext | undefined {
    return this.cls.isActive() ? this.cls.get("scope") : undefined;
  }

  /** Run a callback under a system (un-scoped) context for a deliberate system action. */
  runSystem<T>(fn: () => T): T {
    return this.cls.run(() => {
      this.cls.set("scope", { kind: "system" });
      return fn();
    });
  }
}
