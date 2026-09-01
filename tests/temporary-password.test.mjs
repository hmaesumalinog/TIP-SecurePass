import assert from 'node:assert/strict';
import test from 'node:test';
import { generateTemporaryPassword } from '../netlify/functions/_shared/temporary-password.mjs';

test('temporary passwords satisfy the required character policy', () => {
  for (let index = 0; index < 100; index += 1) {
    const password = generateTemporaryPassword();
    assert.equal(password.length, 16);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[a-z]/);
    assert.match(password, /\d/);
    assert.match(password, /[^A-Za-z0-9]/);
  }
});

test('temporary passwords are not deterministically repeated', () => {
  const passwords = new Set(Array.from({ length: 100 }, () => generateTemporaryPassword()));
  assert.equal(passwords.size, 100);
});
