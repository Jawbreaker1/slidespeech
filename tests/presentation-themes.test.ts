import assert from "node:assert/strict";
import test from "node:test";

import {
  PRESENTATION_THEME_IDS,
  PRESENTATION_THEME_OPTIONS,
  pickPresentationTheme,
  resolvePresentationTheme,
} from "@slidespeech/types";

test("pickPresentationTheme is deterministic for a given seed", () => {
  const first = pickPresentationTheme("deck_123:Warcraft");
  const second = pickPresentationTheme("deck_123:Warcraft");

  assert.equal(first, second);
});

test("resolvePresentationTheme keeps valid stored values", () => {
  assert.equal(resolvePresentationTheme("editorial", "seed"), "editorial");
});

test("resolvePresentationTheme falls back to deterministic selection", () => {
  const resolved = resolvePresentationTheme(undefined, "deck_123:Warcraft");
  assert.equal(resolved, pickPresentationTheme("deck_123:Warcraft"));
});

test("theme options cover every supported presentation theme", () => {
  assert.deepEqual(
    PRESENTATION_THEME_OPTIONS.map((theme) => theme.id),
    [...PRESENTATION_THEME_IDS],
  );
});
