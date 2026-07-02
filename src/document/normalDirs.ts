import path from "node:path";
import { existsSync as nodeExists, readFileSync as nodeRead } from "node:fs";
import { emptyProjectConfig, NormalDirs, parseProjectConfig } from "./schema";
import { PROJECT_FILE } from "./workspace";

/** The filesystem access resolveNormalDirs needs — injectable so it can be unit-tested without real IO. */
export interface ConfigFileReader {
  exists(p: string): boolean;
  read(p: string): string;
}

const nodeReader: ConfigFileReader = {
  exists: nodeExists,
  read: (p) => nodeRead(p, "utf8"),
};

/**
 * Walk up from a doc's directory to the nearest `project.lambert` and return its normal-channel
 * convention; falls back to the default at the filesystem root. Used by the headless CLI (the editor
 * gets its dirs from the open Workspace's already-parsed config).
 */
export function resolveNormalDirs(docDir: string, io: ConfigFileReader = nodeReader): NormalDirs {
  let dir = docDir;
  for (;;) {
    const candidate = path.join(dir, PROJECT_FILE);
    if (io.exists(candidate)) return parseProjectConfig(io.read(candidate)).normalDirs;
    const parent = path.dirname(dir);
    if (parent === dir) return emptyProjectConfig().normalDirs;
    dir = parent;
  }
}
