import { describe, it, expect, beforeEach } from "vitest";
import { getHost, getPort, getRegion, getDbPath, getLogLevel } from "./env.js";

describe("env getters", () => {
  beforeEach(() => {
    delete process.env.HOST;
    delete process.env.PORT;
    delete process.env.MINIMAX_REGION;
    delete process.env.ROUTER_DB_PATH;
    delete process.env.LOG_LEVEL;
  });

  it("getHost defaults to 127.0.0.1", () => {
    expect(getHost()).toBe("127.0.0.1");
  });

  it("getHost honors HOST", () => {
    process.env.HOST = "0.0.0.0";
    expect(getHost()).toBe("0.0.0.0");
  });

  it("getPort defaults to 20137", () => {
    expect(getPort()).toBe(20137);
  });

  it("getPort parses PORT", () => {
    process.env.PORT = "8080";
    expect(getPort()).toBe(8080);
  });

  it("getRegion defaults to intl", () => {
    expect(getRegion()).toBe("intl");
  });

  it("getRegion returns cn when MINIMAX_REGION=cn", () => {
    process.env.MINIMAX_REGION = "cn";
    expect(getRegion()).toBe("cn");
  });

  it("getDbPath returns null when ROUTER_DB_PATH not set (caller resolves default)", () => {
    expect(getDbPath()).toBeNull();
  });

  it("getDbPath returns override when set", () => {
    process.env.ROUTER_DB_PATH = "/tmp/x.db";
    expect(getDbPath()).toBe("/tmp/x.db");
  });

  it("getLogLevel defaults to info", () => {
    expect(getLogLevel()).toBe("info");
  });
});
