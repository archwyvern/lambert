import { expect, test } from "vitest";
import { resolveNormalDirs, type ConfigFileReader } from "../../src/document/normalDirs";
import { DEFAULT_NORMAL_DIRS, serializeProjectConfig } from "../../src/document/schema";

test("resolveNormalDirs walks up to the nearest project.lambert and reads its dirs", () => {
  const cfg = serializeProjectConfig({ schemaVersion: 1, normalDirs: { red: "left", green: "down" } });
  const files: Record<string, string> = { "/proj/project.lambert": cfg };
  const io: ConfigFileReader = { exists: (p) => p in files, read: (p) => files[p]! };
  // a doc nested two levels below the project root still resolves the root's convention
  expect(resolveNormalDirs("/proj/art/ships", io)).toEqual({ red: "left", green: "down" });
});

test("resolveNormalDirs falls back to the default when no project.lambert is found", () => {
  const io: ConfigFileReader = { exists: () => false, read: () => "" };
  expect(resolveNormalDirs("/some/deep/dir", io)).toEqual(DEFAULT_NORMAL_DIRS);
});

test("resolveNormalDirs prefers the CLOSEST project.lambert on the way up", () => {
  const root = serializeProjectConfig({ schemaVersion: 1, normalDirs: { red: "left", green: "down" } });
  const nested = serializeProjectConfig({ schemaVersion: 1, normalDirs: { red: "right", green: "up" } });
  const files: Record<string, string> = { "/proj/project.lambert": root, "/proj/sub/project.lambert": nested };
  const io: ConfigFileReader = { exists: (p) => p in files, read: (p) => files[p]! };
  expect(resolveNormalDirs("/proj/sub/art", io)).toEqual({ red: "right", green: "up" }); // nested wins
});
