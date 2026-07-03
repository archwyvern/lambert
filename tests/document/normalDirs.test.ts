import { expect, test } from "vitest";
import { resolveNormalDirs, type ConfigFileReader } from "../../src/document/normalDirs";
import { DEFAULT_NORMAL_DIRS, emptyProjectConfig, serializeProjectConfig } from "../../src/document/schema";

/** The impl walks with node:path (real OS paths — Windows CLI uses backslashes), so the fake fs
 *  normalizes separators before lookup or the POSIX fixture keys never match on Windows CI. */
const reader = (files: Record<string, string>): ConfigFileReader => {
  const norm = (p: string): string => p.replaceAll("\\", "/");
  return { exists: (p) => norm(p) in files, read: (p) => files[norm(p)]! };
};

test("resolveNormalDirs walks up to the nearest project.lambert and reads its dirs", () => {
  const cfg = serializeProjectConfig({ ...emptyProjectConfig(), normalDirs: { red: "left", green: "down" } });
  const files: Record<string, string> = { "/proj/project.lambert": cfg };
  const io = reader(files);
  // a doc nested two levels below the project root still resolves the root's convention
  expect(resolveNormalDirs("/proj/art/ships", io)).toEqual({ red: "left", green: "down" });
});

test("resolveNormalDirs falls back to the default when no project.lambert is found", () => {
  const io: ConfigFileReader = { exists: () => false, read: () => "" };
  expect(resolveNormalDirs("/some/deep/dir", io)).toEqual(DEFAULT_NORMAL_DIRS);
});

test("resolveNormalDirs prefers the CLOSEST project.lambert on the way up", () => {
  const root = serializeProjectConfig({ ...emptyProjectConfig(), normalDirs: { red: "left", green: "down" } });
  const nested = serializeProjectConfig(emptyProjectConfig());
  const files: Record<string, string> = { "/proj/project.lambert": root, "/proj/sub/project.lambert": nested };
  const io = reader(files);
  expect(resolveNormalDirs("/proj/sub/art", io)).toEqual({ red: "right", green: "up" }); // nested wins
});
