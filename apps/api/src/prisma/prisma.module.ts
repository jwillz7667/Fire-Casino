import {
  Global,
  Injectable,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { prismaSystem } from "@aureus/db";

/** DI token for the un-extended (system) Prisma client. */
export const PRISMA_SYSTEM = Symbol("PRISMA_SYSTEM");

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
  providers: [PrismaLifecycle, { provide: PRISMA_SYSTEM, useValue: prismaSystem }],
  exports: [PRISMA_SYSTEM],
})
export class PrismaModule {}
