import { PrismaClient } from "@prisma/client";
import { loadDotenv } from "@aureus/shared/dotenv";
import { bootstrapAdmin, BootstrapAdminError } from "./bootstrap-admin-service";

loadDotenv();
const prisma = new PrismaClient();

bootstrapAdmin(prisma, process.env)
  .then(() => {
    process.stdout.write("Administrator created. Complete MFA enrollment on the first sign-in.\n");
  })
  .catch((error: unknown) => {
    console.error(
      error instanceof BootstrapAdminError
        ? error.message
        : "Administrator bootstrap failed; verify the database connection and applied migrations.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
