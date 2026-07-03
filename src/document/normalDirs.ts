import path from "node:path";
import { existsSync as nodeExists, readFileSync as nodeRead } from "node:fs";
import { emptyProjectConfig, NormalDirs, parseProjectConfig, ProjectConfig } from "./schema";
import { PROJECT_FILE } from "./workspace";

/** The filesystem access resolveProjectConfig needs — injectable so it can be unit-tested without real IO. */
export interface ConfigFileReader {
  exists(p: string): boolean;
  read(p: string): string;
}

const nodeReader: ConfigFileReader = {
  exists: nodeExists,
  read: (p) => nodeRead(p, "utf8"),
};

/**
 * Walk up from a doc's directory to the nearest `project.lambert` and return its config; falls back
 * to the defaults at the filesystem root. Used by the headless CLI (the editor gets its config from
 * the open Workspace).
 */
export function resolveProjectConfig(docDir: string, io: ConfigFileReader = nodeReader): ProjectConfig {
  let dir = docDir;
  for (;;) {
    const candidate = path.join(dir, PROJECT_FILE);
    if (io.exists(candidate)) return parseProjectConfig(io.read(candidate));
    const parent = path.dirname(dir);
    if (parent === dir) return emptyProjectConfig();
    dir = parent;
  }
}

/** The nearest project's normal-channel convention (see {@link resolveProjectConfig}). */
export function resolveNormalDirs(docDir: string, io: ConfigFileReader = nodeReader): NormalDirs {
  return resolveProjectConfig(docDir, io).normalDirs;
}
