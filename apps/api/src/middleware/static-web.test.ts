import { describe, expect, it } from "vitest";
import { isSingleDomainDeploy } from "./static-web.js";

describe("isSingleDomainDeploy", () => {
  it("returns false outside production", () => {
    expect(isSingleDomainDeploy()).toBe(false);
  });
});
