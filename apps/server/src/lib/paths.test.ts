import { describe, expect, it } from "vitest";
import { normalizeHostDir, safeUploadName } from "./paths";

describe("safeUploadName", () => {
  it("keeps only the final path component", () => {
    expect(safeUploadName("../../etc/passwd")).toBe("passwd");
    expect(safeUploadName("C:\\Users\\me\\app.tar")).toBe("app.tar");
    expect(safeUploadName("notes.md")).toBe("notes.md");
  });

  it("rejects empty and dot-only names", () => {
    expect(() => safeUploadName("")).toThrow();
    expect(() => safeUploadName("..")).toThrow();
    expect(() => safeUploadName("dir/")).toThrow();
  });
});

describe("normalizeHostDir", () => {
  it("requires an absolute path", () => {
    expect(() => normalizeHostDir("tmp/uploads")).toThrow();
  });

  it("normalizes separators and trailing slashes", () => {
    expect(normalizeHostDir("/srv//apps/")).toBe("/srv/apps");
    expect(normalizeHostDir("/")).toBe("/");
  });
});
