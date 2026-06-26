import { SanctionsEntry } from './types';

/**
 * Sample OFAC/PEP sanctions entries (public/historical names) plus a TEST entry so
 * the feature is demonstrable. PRODUCTION: replace/extend with the full OFAC SDN
 * list — load it from the official source and pass the parsed entries to
 * `new ScreeningService(entries, ...)`. `parseSimpleList` handles a basic
 * "name|aka1;aka2|list|program" format for an admin-supplied file.
 */
export const DEFAULT_SANCTIONS: SanctionsEntry[] = [
  { name: 'Usama bin Laden', aka: ['Osama Bin Laden', 'Usama bin Muhammad bin Awad bin Ladin'], list: 'OFAC-SDN', program: 'SDGT' },
  { name: 'Saddam Hussein Al-Tikriti', aka: ['Saddam Hussein'], list: 'OFAC-SDN', program: 'IRAQ2' },
  { name: 'Joaquin Archivaldo Guzman Loera', aka: ['El Chapo', 'Joaquin Guzman'], list: 'OFAC-SDN', program: 'SDNTK' },
  { name: 'Nicolas Maduro Moros', aka: ['Nicolas Maduro'], list: 'OFAC-SDN', program: 'VENEZUELA' },
  { name: 'Blocked Testperson', aka: ['Test Sanctioned'], list: 'TEST', program: 'DEMO' },
];

/** Parse "name|aka1;aka2|list|program" lines (one per row) into entries. */
export function parseSimpleList(text: string): SanctionsEntry[] {
  const out: SanctionsEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [name, aka, list, program] = t.split('|');
    if (!name || !list) continue;
    out.push({
      name: name.trim(),
      ...(aka ? { aka: aka.split(';').map((s) => s.trim()).filter(Boolean) } : {}),
      list: list.trim(),
      ...(program ? { program: program.trim() } : {}),
    });
  }
  return out;
}
