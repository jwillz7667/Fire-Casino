import { describe, expect, it } from "vitest";
import { bullConnection } from "./bull-connection";

describe("BullMQ Redis URL configuration", () => {
  it("enables verified TLS for a managed rediss provider", () => {
    expect(bullConnection("rediss://user%40tenant:p%3Aa%40ss@redis.example.com:6380/2")).toEqual({
      host: "redis.example.com",
      port: 6380,
      username: "user@tenant",
      password: "p:a@ss",
      db: 2,
      tls: {},
      maxRetriesPerRequest: null,
    });
  });

  it("retains plain Redis support for private networks", () => {
    expect(bullConnection("redis://localhost")).toEqual({
      host: "localhost",
      port: 6379,
      username: undefined,
      password: undefined,
      db: undefined,
      maxRetriesPerRequest: null,
    });
  });

  it.each(["https://redis.example.com", "redis://localhost/-1", "redis://localhost/not-a-db"])(
    "rejects unsupported Redis configuration: %s",
    (url) => expect(() => bullConnection(url)).toThrow(),
  );
});
