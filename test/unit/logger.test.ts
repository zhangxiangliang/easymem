import { jest } from "@jest/globals";

import { createLogger, log } from "../../src/logger.js";

describe("createLogger", () => {
  let stderr: ReturnType<typeof jest.spyOn>;
  let stdout: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    stderr = jest.spyOn(console, "error").mockImplementation(() => {});
    stdout = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    stderr.mockRestore();
    stdout.mockRestore();
  });

  it("never writes to stdout", () => {
    // stdout carries JSON-RPC frames when the process is serving MCP. One line
    // of log there corrupts the protocol and the client drops the connection.
    const logger = createLogger("test");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(stdout).not.toHaveBeenCalled();
  });

  it("writes warn and error at the default level", () => {
    const logger = createLogger("test");
    logger.warn("careful");
    logger.error("broken");
    expect(stderr).toHaveBeenCalledTimes(2);
  });

  it("stays quiet below the level, so a served process is silent by default", () => {
    const logger = createLogger("test");
    logger.debug("noise");
    logger.info("chatter");
    expect(stderr).not.toHaveBeenCalled();
  });

  it("stamps the level, the tag and the message", () => {
    createLogger("wiki").warn("something happened");
    const line = String(stderr.mock.calls[0]![0]);
    expect(line).toContain("[WARN ]");
    expect(line).toContain("[wiki]");
    expect(line).toContain("something happened");
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/);
  });

  it("appends structured data as one line of JSON", () => {
    createLogger("wiki").error("failed", { pages: 3, why: "disk" });
    const line = String(stderr.mock.calls[0]![0]);
    expect(line).toContain('{"pages":3,"why":"disk"}');
    expect(line.split("\n")).toHaveLength(1);
  });

  it("leaves the message alone when there is no data", () => {
    createLogger("wiki").warn("plain");
    expect(String(stderr.mock.calls[0]![0])).toMatch(/\[wiki\] plain$/);
  });

  it("exports a ready-made logger tagged app", () => {
    log.warn("from the default logger");
    expect(String(stderr.mock.calls[0]![0])).toContain("[app]");
  });
});
