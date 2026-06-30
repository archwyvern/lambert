import { expect, test } from "vitest";
import { pushRecent, removeRecent, RecentProject } from "../../src/document/recents";

const r = (path: string, name: string, lastOpened: number): RecentProject => ({ path, name, lastOpened });

test("pushRecent prepends the opened project, newest first", () => {
  let list: RecentProject[] = [];
  list = pushRecent(list, "/p/a", "a", 1);
  list = pushRecent(list, "/p/b", "b", 2);
  expect(list.map((x) => x.path)).toEqual(["/p/b", "/p/a"]);
  expect(list[0]).toEqual({ path: "/p/b", name: "b", lastOpened: 2 });
});

test("pushRecent dedups by path, moving the existing entry to the front with fresh time/name", () => {
  let list = [r("/p/c", "c", 3), r("/p/b", "b", 2), r("/p/a", "a", 1)]; // newest first, the stored invariant
  list = pushRecent(list, "/p/a", "a-renamed", 9);
  expect(list.map((x) => x.path)).toEqual(["/p/a", "/p/c", "/p/b"]);
  expect(list[0]).toEqual({ path: "/p/a", name: "a-renamed", lastOpened: 9 });
  expect(list.length).toBe(3); // no duplicate
});

test("pushRecent caps the list at the limit, dropping the oldest", () => {
  let list: RecentProject[] = [];
  for (let i = 0; i < 15; i++) list = pushRecent(list, `/p/${i}`, `${i}`, i, 10);
  expect(list.length).toBe(10);
  expect(list[0]!.path).toBe("/p/14"); // newest kept
  expect(list[list.length - 1]!.path).toBe("/p/5"); // oldest survivors; /p/0../p/4 evicted
});

test("removeRecent drops the matching path, leaves the rest in order", () => {
  const list = [r("/p/a", "a", 1), r("/p/b", "b", 2), r("/p/c", "c", 3)];
  expect(removeRecent(list, "/p/b").map((x) => x.path)).toEqual(["/p/a", "/p/c"]);
  expect(removeRecent(list, "/p/missing")).toEqual(list); // no-op when absent
});
