import test from "node:test";
import assert from "node:assert/strict";
import { dictionaries, translate, isLang, LANGS } from "../lib/i18n.js";

test("every language has exactly the same keys as English", () => {
  const en = Object.keys(dictionaries.en).sort();
  for (const lang of LANGS) {
    assert.deepEqual(Object.keys(dictionaries[lang]).sort(), en, `${lang} keys differ from en`);
  }
});

test("no translation is empty, and {placeholders} match English", () => {
  const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
  for (const lang of LANGS) {
    for (const [k, v] of Object.entries(dictionaries[lang])) {
      assert.ok(v.trim().length > 0, `${lang}.${k} is empty`);
      assert.equal(ph(v), ph(dictionaries.en[k]), `${lang}.${k} placeholders differ`);
    }
  }
});

test("translate: language, fallback, interpolation", () => {
  assert.equal(translate("sw", "nav.home"), "Mwanzo");
  assert.equal(translate("en", "nav.home"), "Home");
  assert.equal(translate("xx", "nav.home"), "Home");
  assert.equal(translate("sw", "no.such.key"), "no.such.key");
  assert.equal(translate("en", "spending.left", { amount: "KES 50" }), "KES 50 left");
  assert.equal(translate("sw", "spending.left", { amount: "KES 50" }), "KES 50 imebaki");
  assert.equal(translate("en", "spending.left", {}), "{amount} left");
});

test("isLang", () => {
  assert.equal(isLang("sw"), true);
  assert.equal(isLang("fr"), false);
  assert.equal(isLang(undefined), false);
});
