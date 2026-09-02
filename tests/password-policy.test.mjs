import assert from 'node:assert/strict';
import test from 'node:test';

import { validatePassword } from '../netlify/functions/_shared/http.mjs';

test('accepts a strong permanent password that excludes the student number', () => {
  assert.equal(validatePassword('A-correct horse 42!', '2026008'), true);
});

test('rejects the exact seven-digit student number anywhere in the password', () => {
  assert.equal(validatePassword('Strong!2026008x', '2026008'), false);
});

test('uses a conservative seven-digit check when the identifier is unavailable', () => {
  assert.equal(validatePassword('Strong!2026008x'), false);
});
