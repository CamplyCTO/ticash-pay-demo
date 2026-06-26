/**
 * AML / sanctions screening (PEP/OFAC). A `ScreeningService` matches a name against
 * a sanctions list and BLOCKS on a hit, recording it for review. The list is a port
 * — ships with a sample OFAC/PEP set, pluggable to the full OFAC SDN or a paid
 * provider in production.
 */

export interface SanctionsEntry {
  name: string;
  aka?: string[];
  list: string; // e.g. 'OFAC-SDN'
  program?: string; // e.g. 'SDGT'
}

export interface ScreeningMatch {
  list: string;
  program?: string;
  matchedName: string;
  score: number; // 0..1
}

export interface ScreeningResult {
  name: string;
  context: string; // 'charge' | 'transfer' | 'manual'
  hit: boolean;
  matches: ScreeningMatch[];
}

export interface HitRecord {
  subject: string;
  context: string;
  list: string;
  matchedName: string;
  score: number;
  createdAt: string;
}

export interface ScreeningStore {
  record(hit: Omit<HitRecord, 'createdAt'>): Promise<void>;
  list(limit?: number): Promise<HitRecord[]>;
}
