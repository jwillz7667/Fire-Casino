// Test environment defaults. Real env (CI) wins; these fill gaps for local runs.
// Imported via vitest `setupFiles` before any module that reads process.env.
function def(key: string, value: string): void {
  if (!process.env[key]) process.env[key] = value;
}

def("NODE_ENV", "test");
def("DATABASE_URL", "postgresql://aureus:aureus@localhost:5432/aureus_test");
// Integration fixtures truncate their database. Never alias a live DATABASE_URL
// into TEST_DATABASE_URL; callers must supply the isolated fixture URL explicitly.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
def("REDIS_URL", "redis://localhost:6379");
def("JWT_ACCESS_SECRET", "test-access-secret-at-least-16-chars");
def("JWT_REFRESH_SECRET", "test-refresh-secret-at-least-16-chars");
def("CREDIT_MINOR_UNITS", "1000");
def("PLATFORM_MODE", "OPERATOR");
