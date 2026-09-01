import { randomInt } from 'node:crypto';

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%*-_+';
const ALL = `${UPPER}${LOWER}${DIGITS}${SYMBOLS}`;

function pick(characters) {
  return characters[randomInt(characters.length)];
}

export function generateTemporaryPassword(length = 16) {
  const characters = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (characters.length < length) characters.push(pick(ALL));
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join('');
}
