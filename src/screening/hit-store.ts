import { HitRecord, ScreeningStore } from './types';

export class InMemoryScreeningStore implements ScreeningStore {
  private readonly hits: HitRecord[] = [];
  constructor(private readonly clock: () => string = () => new Date(Date.UTC(2026, 0, 1)).toISOString()) {}
  async record(hit: Omit<HitRecord, 'createdAt'>): Promise<void> {
    this.hits.push({ ...hit, createdAt: this.clock() });
  }
  async list(limit = 100): Promise<HitRecord[]> {
    return this.hits.slice(-limit).reverse();
  }
}
