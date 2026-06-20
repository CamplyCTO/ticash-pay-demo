import { describe, expect, it } from 'vitest';
import { closePool, getPool } from '../src/db/pool';

describe('pg pool resilience', () => {
  it('attaches an idle-client error handler (so a DB restart/failover does not crash the process)', async () => {
    // Creating the Pool does not open a connection; we only assert the guard exists.
    const pool = getPool();
    expect(pool.listenerCount('error')).toBeGreaterThan(0);
    await closePool();
  });
});
