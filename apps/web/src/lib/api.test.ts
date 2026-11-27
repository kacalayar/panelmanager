import { describe, expect, it } from "vitest";
import { getAuthToken, getWsBaseUrl } from "./api";

describe("web api helpers", () => {
  it("falls back safely in SSR/node environment", () => {
    expect(getAuthToken()).toBe("");
    expect(getWsBaseUrl()).toBe("ws://localhost:3001");
  });
});
