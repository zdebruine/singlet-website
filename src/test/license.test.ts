// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("license statement", () => {
  it("is code MIT, data CC0 in the license files, package.json and the README", () => {
    expect(read("LICENSE")).toMatch(/^MIT License/);
    expect(read("LICENSE-DATA")).toMatch(/CC0 1\.0 Universal/);
    expect(JSON.parse(read("package.json")).license).toBe("MIT");
    expect(read("README.md")).toMatch(/Data is CC0 1\.0.*code is MIT/);
  });

  it("is the same on the license page", () => {
    const page = read("src/pages/DataLicense.tsx");
    expect(page).not.toMatch(/Singlet Cloud/);
    expect(page).toMatch(/site code and the singlet client are MIT/);
  });
});
