import { expect, test } from "vitest";
import { basename, dirname, joinPath } from "../../src/document/paths";

test("posix behaviour is preserved (regression)", () => {
  expect(dirname("/a/b")).toBe("/a");
  expect(dirname("/a")).toBe("/");
  expect(dirname("/")).toBe("/");
  expect(basename("/a/b")).toBe("b");
  expect(basename("/a/b/")).toBe("b"); // trailing slash
  expect(joinPath("/a/b", "../c")).toBe("/a/c");
  expect(joinPath("/a", "b/c")).toBe("/a/b/c");
  expect(joinPath("/a/b", "./c")).toBe("/a/b/c");
});

test("Windows drive paths (backslashes + drive letter)", () => {
  expect(dirname("C:\\a\\b")).toBe("C:\\a");
  expect(dirname("C:\\a")).toBe("C:\\");
  expect(dirname("C:\\")).toBe("C:\\");
  expect(basename("C:\\a\\b.png")).toBe("b.png");
  expect(basename("C:\\a\\b\\")).toBe("b");
  expect(joinPath("C:\\a\\b", "..\\c")).toBe("C:\\a\\c");
  expect(joinPath("C:\\a", "b\\c")).toBe("C:\\a\\b\\c");
});

test("mixed separators resolve; drive with forward slashes stays forward-slashed", () => {
  expect(basename("C:/users/art/normal.lmb")).toBe("normal.lmb");
  expect(dirname("C:/users/art/normal.lmb")).toBe("C:/users/art");
  expect(joinPath("C:/proj", "sub/x.lmb")).toBe("C:/proj/sub/x.lmb");
});
