import test from "node:test";
import assert from "node:assert/strict";
import { extractNationalNumber, isValidKenyanMobile, toE164, toDaraja, formatNational } from "../lib/phone.js";

test("extractNationalNumber normalises every common input shape", () => {
  for (const input of ["0712345678", "0712 345 678", "+254712345678", "+254 712 345 678", "254712345678", "712345678", "(0712) 345-678"]) {
    assert.equal(extractNationalNumber(input), "712345678", input);
  }
  assert.equal(extractNationalNumber("0112345678"), "112345678");
  assert.equal(extractNationalNumber("+254112345678"), "112345678");
});

test("extractNationalNumber is safe on junk and caps at 9 digits", () => {
  assert.equal(extractNationalNumber(""), "");
  assert.equal(extractNationalNumber(null), "");
  assert.equal(extractNationalNumber(undefined), "");
  assert.equal(extractNationalNumber("abc"), "");
  assert.equal(extractNationalNumber("07123456789999"), "712345678");
  assert.equal(extractNationalNumber(12345), "12345");
});

test("typing digit-by-digit never corrupts the value", () => {
  let v = "";
  for (const ch of "0712345678") v = extractNationalNumber(v + ch);
  assert.equal(v, "712345678");
  v = "";
  for (const ch of "254712345678") v = extractNationalNumber(v + ch);
  assert.equal(v, "712345678");
});

test("isValidKenyanMobile", () => {
  assert.equal(isValidKenyanMobile("712345678"), true);
  assert.equal(isValidKenyanMobile("112345678"), true);
  assert.equal(isValidKenyanMobile("812345678"), false);
  assert.equal(isValidKenyanMobile("71234567"), false);
  assert.equal(isValidKenyanMobile("7123456789"), false);
  assert.equal(isValidKenyanMobile("71234567a"), false);
  assert.equal(isValidKenyanMobile(""), false);
  assert.equal(isValidKenyanMobile(null), false);
});

test("output formats", () => {
  assert.equal(toE164("712345678"), "+254712345678");
  assert.equal(toDaraja("712345678"), "254712345678");
  assert.equal(formatNational("712345678"), "712 345 678");
  assert.equal(formatNational("7123"), "712 3");
});
