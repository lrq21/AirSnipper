export type GenerationPattern = 'letters' | 'letters_numbers' | 'underscore_letters' | 'random';

export function cleanUsername(value: string): string {
  return value.trim().replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_.]/g, '');
}

export function cleanUsernameList(values: string[]): string[] {
  return [...new Set(values.map(cleanUsername).filter((value) => value.length >= 2 && value.length <= 32))];
}
