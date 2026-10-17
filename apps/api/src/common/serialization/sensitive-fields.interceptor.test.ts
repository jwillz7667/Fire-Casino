import { type CallHandler, type ExecutionContext } from "@nestjs/common";
import { firstValueFrom, of } from "rxjs";
import { describe, expect, it } from "vitest";
import { SensitiveFieldsInterceptor } from "./sensitive-fields.interceptor";

describe("sensitive response fields", () => {
  it("redacts every occurrence of a shared nested object", async () => {
    const user = {
      id: "u1",
      passwordHash: "secret-hash",
      mfaSecret: "secret-factor",
      tokenHash: "secret-token",
    };
    const data = { user, nested: [{ owner: user }] };
    const output = await firstValueFrom(
      new SensitiveFieldsInterceptor().intercept(
        {} as ExecutionContext,
        { handle: () => of(data) } as CallHandler,
      ),
    );
    expect(output).toEqual({ user: { id: "u1" }, nested: [{ owner: { id: "u1" } }] });
    expect(user.passwordHash).toBe("secret-hash");
  });
});
