import assert from "node:assert/strict";
import test from "node:test";
import { allowAllUsers, canUseBot } from "../src/access.js";

test("未指定時は管理者と許可ユーザーだけが利用できる", () => {
  const allowed = new Set(["admin", "member"]);
  assert.equal(allowAllUsers(undefined), false);
  assert.equal(canUseBot("admin", false, allowed), true);
  assert.equal(canUseBot("member", false, allowed), true);
  assert.equal(canUseBot("other", false, allowed), false);
});

test("true は許可ユーザー指定のない利用者も許可する", () => {
  assert.equal(allowAllUsers("true"), true);
  assert.equal(canUseBot("other", true, new Set(["admin"])), true);
});

test("不正な設定値は起動時に拒否する", () => {
  assert.throws(() => allowAllUsers("all"), /DISCORD_ALLOW_ALL_USERS/);
});
