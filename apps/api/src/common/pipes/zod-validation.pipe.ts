import { type PipeTransform } from "@nestjs/common";
import { type ZodType } from "zod";
import { ValidationError } from "../errors/domain-error";

/**
 * Validates a request part against a zod schema and returns the parsed,
 * typed value. Schemas are defined once in @aureus/shared and used on both ends
 * (docs/05 §12). Money fields parse to BigInt via zMinor.
 *
 * Usage: `@Body(new ZodValidationPipe(schema)) dto: Input`.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ValidationError(result.error.flatten());
    }
    return result.data;
  }
}

/** Terse factory: `@Body(zBody(schema))`. */
export function zBody<T>(schema: ZodType<T>): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}
