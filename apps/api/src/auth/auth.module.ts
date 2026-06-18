import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { AccessTokenGuard } from "../common/auth/access-token.guard";
import { MfaEnrollmentGuard } from "../common/auth/mfa-enrollment.guard";
import { PermissionGuard } from "../common/auth/permission.guard";
import { ScopeGuard } from "../common/auth/scope.guard";
import { AllExceptionsFilter } from "../common/errors/exception.filter";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { LoginThrottleService } from "./login-throttle.service";
import { MfaCryptoService } from "./mfa-crypto.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";

/**
 * Auth + the global security pipeline. Guards run in registration order:
 *   AccessTokenGuard (authn + scope seeding) → MfaEnrollmentGuard (forced 2FA) →
 *   PermissionGuard (RBAC) → ScopeGuard (subtree).
 * The exception filter maps domain errors to the stable error envelope.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    LoginThrottleService,
    MfaCryptoService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: MfaEnrollmentGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: ScopeGuard },
  ],
  exports: [AuthService, TokenService, PasswordService],
})
export class AuthModule {}
