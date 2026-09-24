import assert from "node:assert/strict";
import { test } from "node:test";
import { defaults } from "../src/config.js";
import { progressPages, textPages, type ProgressEntry } from "../src/progress-format.js";
import { reasoningSummary } from "../src/reasoning-summary.js";

const model: ProgressEntry = { kind: "model", requested: "openrouter:openrouter/free", actual: null };

test("モデルを先に表示し、思考とツールを発生順に並べる", () => {
  const entries: ProgressEntry[] = [model, { kind: "thought", text: "考え中", summary: "" },
    { kind: "tool", id: "1", name: "read", status: "done" },
    { kind: "thought", text: "続き", summary: "" }];
  const pages = progressPages(defaults, entries);
  assert.equal(pages.length, 1);
  assert.ok(pages[0]!.indexOf("考え中") < pages[0]!.indexOf("read"));
  assert.match(pages[0]!, /続き/);
});

test("思考行を表示し、空の進行行を追加しない", () => {
  const header = progressPages(defaults, [model,
    { kind: "thought", text: "一行目", summary: "" },
    { kind: "thought", text: "二行目", summary: "" },
  ])[0]!;
  assert.equal(header, "-# 🤖 openrouter/free\n-# 🧐 一行目\n-# 🧐 二行目");
  assert.doesNotMatch(header, /\n-#\s*\n/);
  const twoThoughts = progressPages(defaults, [model,
    { kind: "thought", text: "あ".repeat(500), summary: "" },
    { kind: "thought", text: "い".repeat(500), summary: "" },
  ]);
  assert.equal(twoThoughts.length, 1);
  assert.doesNotMatch(twoThoughts[0]!, /Receiving stream response/);
});

test("実モデルは先頭行を更新する", () => {
  const route: ProgressEntry = { kind: "model", requested: "openrouter:openrouter/free", actual: "openrouter:liquid/lfm-2.5-2.6b:free" };
  assert.equal(progressPages(defaults, [route])[0], "-# 🤖 openrouter/free → openrouter:liquid/lfm-2.5-2.6b:free");
});

test("要約優先では元の思考行を差し替え、無い場合は設定したフォールバックを使う", () => {
  const settings = { ...defaults, reasoning_display: "summary" as const };
  const thought: ProgressEntry = { kind: "thought", text: "途中", summary: "" };
  assert.match(progressPages(settings, [model, thought])[0]!, /途中/);
  thought.summary = "要約";
  assert.match(progressPages(settings, [model, thought])[0]!, /要約/);
  assert.doesNotMatch(progressPages(settings, [model, thought])[0]!, /途中/);
  thought.summary = "";
  assert.equal(progressPages({ ...settings, reasoning_summary_fallback: "hide" }, [model, thought])[0], "-# 🤖 openrouter/free");
});

test("テンプレートと表示設定を適用し、危険な Markdown と長文を抑える", () => {
  const settings = { ...defaults, model_display: "requested" as const, model_template: "Model: ${model}" };
  assert.equal(progressPages(settings, [model])[0], "Model: openrouter/free");
  const content = progressPages(defaults, [model, { kind: "thought", text: "**強調**\n[link](https://example.com)" + "考".repeat(3000), summary: "" }])[0]!;
  assert.ok(content.length <= 1201);
  assert.match(content, /\\\*\\\*強調/);
});

test("ツールの全履歴を順に分割する", () => {
  const entries: ProgressEntry[] = [model, ...Array.from({ length: 7 }, (_, index): ProgressEntry =>
    ({ kind: "tool", id: `${index}`, name: `tool${index}${"x".repeat(400)}`, status: "done" }))];
  const pages = progressPages(defaults, entries);
  assert.ok(pages.length > 1);
  assert.match(pages[0]!, /tool0/);
  assert.match(pages.at(-1)!, /tool6/);
});

test("Pi の思考署名から reasoning.summary だけ取り出す", () => {
  assert.equal(reasoningSummary([{ type: "thinking", thinkingSignature: JSON.stringify([
    { type: "reasoning.text", text: "詳細" }, { type: "reasoning.summary", summary: "短い要約" },
  ]) }]), "短い要約");
  assert.equal(reasoningSummary([{ type: "thinking", thinkingSignature: "opaque" }]), "");
});

test("本文メッセージには本文だけを入れ、長文を分割する", () => {
  assert.deepEqual(textPages("回答"), ["回答"]);
  assert.equal(textPages("考".repeat(4000)).length, 3);
  assert.ok(textPages("考".repeat(4000)).every((page) => page.length <= 1900));
  assert.deepEqual(textPages(""), []);
});
