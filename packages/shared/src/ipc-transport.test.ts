import { describe, expect, it } from "vitest";
import {
  BULK_IPC_FRAME_BYTES,
  isBulkPayload,
  readRangeRequest,
  splitRange,
} from "./ipc-transport.js";

describe("ipc bulk policy", () => {
  it("treats 64KB as the bulk boundary", () => {
    expect(BULK_IPC_FRAME_BYTES).toBe(65536);
    expect(isBulkPayload(65536)).toBe(false);
    expect(isBulkPayload(65537)).toBe(true);
  });

  it("builds bounded range requests", () => {
    expect(readRangeRequest("src/a.ts", -5, 0)).toMatchObject({ offset: 0, limit: 1 });
    expect(readRangeRequest("src/a.ts", 10, 5000).limit).toBe(2000);
  });

  it("splits windows into chunks", () => {
    expect(splitRange(0, 450)).toHaveLength(3);
  });
});
