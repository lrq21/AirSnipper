const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const NUMBERS = '0123456789';
const LETTERS_AND_NUMBERS = `${LETTERS}${NUMBERS}`;

export type GenerationPattern = 'letters' | 'letters_numbers' | 'underscore_letters' | 'random';

function randomChar(charset: string): string {
  return charset[Math.floor(Math.random() * charset.length)];
}

function shuffle<T>(values: T[]): T[] {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  return values;
}

function generateLetters(length: number): string {
  return Array.from({ length }, () => randomChar(LETTERS)).join('');
}

function generateNumbers(length: number): string {
  return Array.from({ length }, () => randomChar(NUMBERS)).join('');
}

function generateLettersAndNumbers(length: number): string {
  if (length < 2) return randomChar(LETTERS_AND_NUMBERS);
  const chars = [randomChar(LETTERS), randomChar(NUMBERS)];
  while (chars.length < length) chars.push(randomChar(LETTERS_AND_NUMBERS));
  return shuffle(chars).join('');
}

function generateUnderscorePattern(length: number): string {
  if (length === 1) return '_';
  const underscorePosition = Math.floor(Math.random() * (length - 1)) + 1;
  return Array.from({ length }, (_, index) => index === underscorePosition ? '_' : randomChar(LETTERS_AND_NUMBERS)).join('');
}

export function cleanUsername(value: string): string {
  return value.trim().replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_.]/g, '');
}

export function cleanUsernameList(values: string[]): string[] {
  return [...new Set(values.map(cleanUsername).filter((value) => value.length >= 2 && value.length <= 32))];
}

export function generateUsername(length: number, pattern: GenerationPattern): string {
  if (pattern === 'letters') return generateLetters(length);
  if (pattern === 'letters_numbers') return generateLettersAndNumbers(length);
  if (pattern === 'underscore_letters') return generateUnderscorePattern(length);

  const randomPattern = Math.floor(Math.random() * 4);
  if (randomPattern === 0) return generateLetters(length);
  if (randomPattern === 1) return generateNumbers(length);
  if (randomPattern === 2) return generateLettersAndNumbers(length);
  return generateUnderscorePattern(length);
}
