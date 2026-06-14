import { Inject, Injectable } from "@nestjs/common";
import { hash, verify } from "@node-rs/argon2";
import { type Env } from "@aureus/shared";
import { ENV } from "../config/config.module";

/** Argon2id password hashing (docs/01 §4). Memory cost from ARGON2_MEMORY_KIB. */
@Injectable()
export class PasswordService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  hash(plain: string): Promise<string> {
    return hash(plain, {
      memoryCost: this.env.ARGON2_MEMORY_KIB,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verify(passwordHash: string, plain: string): Promise<boolean> {
    try {
      return await verify(passwordHash, plain);
    } catch {
      return false;
    }
  }
}
