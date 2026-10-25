import { TrafikverketClientError } from './errors.js';

/** Swedish counties (län) with the official two-digit county codes used by Trafikverket (`CountyNo`). */
export const COUNTIES: ReadonlyArray<{ code: number; name: string; aliases?: string[] }> = [
  { code: 1, name: 'Stockholm' },
  { code: 3, name: 'Uppsala' },
  { code: 4, name: 'Södermanland', aliases: ['Sormland'] },
  { code: 5, name: 'Östergötland', aliases: ['Ostergotland'] },
  { code: 6, name: 'Jönköping', aliases: ['Jonkoping'] },
  { code: 7, name: 'Kronoberg' },
  { code: 8, name: 'Kalmar' },
  { code: 9, name: 'Gotland' },
  { code: 10, name: 'Blekinge' },
  { code: 12, name: 'Skåne', aliases: ['Skane', 'Scania'] },
  { code: 13, name: 'Halland' },
  { code: 14, name: 'Västra Götaland', aliases: ['Vastra Gotaland', 'Gothenburg'] },
  { code: 17, name: 'Värmland', aliases: ['Varmland'] },
  { code: 18, name: 'Örebro', aliases: ['Orebro'] },
  { code: 19, name: 'Västmanland', aliases: ['Vastmanland'] },
  { code: 20, name: 'Dalarna' },
  { code: 21, name: 'Gävleborg', aliases: ['Gavleborg'] },
  { code: 22, name: 'Västernorrland', aliases: ['Vasternorrland'] },
  { code: 23, name: 'Jämtland', aliases: ['Jamtland', 'Jämtland Härjedalen', 'Jamtland Harjedalen'] },
  { code: 24, name: 'Västerbotten', aliases: ['Vasterbotten'] },
  { code: 25, name: 'Norrbotten' },
];

/** Lower-cases and strips diacritics, whitespace noise and "län"/"county" suffixes for matching. */
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(lan|county)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves a county given as a Swedish name ("Västra Götaland", "Skåne län"), an English alias
 * ("Scania") or a numeric county code (14 or "14") to its numeric code.
 */
export function resolveCounty(input: string | number): number {
  if (typeof input === 'number' || /^\d+$/.test(input.trim())) {
    const code = Number(input);
    if (COUNTIES.some((c) => c.code === code)) return code;
    throw new TrafikverketClientError(
      `Unknown county code ${code}. Valid codes: ${COUNTIES.map((c) => c.code).join(', ')}`
    );
  }

  const wanted = normalizeName(input);
  const match = COUNTIES.find(
    (c) => normalizeName(c.name) === wanted || (c.aliases ?? []).some((a) => normalizeName(a) === wanted)
  );
  if (!match) {
    throw new TrafikverketClientError(
      `Unknown county "${input}". Use a Swedish county name (e.g. "Västra Götaland") or code. ` +
        `Valid counties: ${COUNTIES.map((c) => `${c.name} (${c.code})`).join(', ')}`
    );
  }
  return match.code;
}
