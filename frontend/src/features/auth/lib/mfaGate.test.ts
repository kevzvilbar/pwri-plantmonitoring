import { describe, expect, it } from 'vitest';
import { resolveMfaGate } from './mfaGate';

const base = { currentLevel: 'aal1', nextLevel: 'aal1', required: false, skipped: false } as const;

describe('resolveMfaGate', () => {
  it('allows an aal2 session', () => {
    expect(resolveMfaGate({ ...base, currentLevel: 'aal2', nextLevel: 'aal2', required: true })).toBe('allow');
  });
  it('challenges an enrolled admin on aal1, whether or not enforcement is on', () => {
    expect(resolveMfaGate({ ...base, nextLevel: 'aal2' })).toBe('challenge');
    expect(resolveMfaGate({ ...base, nextLevel: 'aal2', required: true, skipped: true })).toBe('challenge');
  });
  it('forces enrollment when required, ignoring skip', () => {
    expect(resolveMfaGate({ ...base, required: true, skipped: true })).toBe('enroll');
  });
  it('offers skippable enrollment while enforcement is off', () => {
    expect(resolveMfaGate(base)).toBe('enroll-optional');
    expect(resolveMfaGate({ ...base, skipped: true })).toBe('allow');
  });
});
