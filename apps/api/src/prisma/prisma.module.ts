import {
  Global,
  Injectable,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { createScopedPrisma, prismaSystem } from "@aureus/db";
import { type AppClsStore } from "../common/scope/scope.service";

/** DI token for the un-extended (system) Prisma client — ledger, workers, seed. */
export const PRISMA_SYSTEM = Symbol("PRISMA_SYSTEM");

/**
 * DI token for the subtree-scoped Prisma client — request handlers. Reads the
 * caller scope from AsyncLocalStorage at query time and injects path filters
 * (docs/04 §2). Fails closed when no scope is set.
 */
export const PRISMA = Symbol("PRISMA");

/** Manages the shared client's connection lifecycle with the Nest app. */
@Injectable()
class PrismaLifecycle implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await prismaSystem.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await prismaSystem.$disconnect();
  }
}

@Global()
@Module({
  providers: [
    PrismaLifecycle,
    { provide: PRISMA_SYSTEM, useValue: prismaSystem },
    {
      provide: PRISMA,
      inject: [ClsService],
      useFactory: (cls: ClsService<AppClsStore>) =>
        createScopedPrisma(prismaSystem, () => (cls.isActive() ? cls.get("scope") : undefined)),
    },
  ],
  exports: [PRISMA_SYSTEM, PRISMA],
})
export class PrismaModule {}
