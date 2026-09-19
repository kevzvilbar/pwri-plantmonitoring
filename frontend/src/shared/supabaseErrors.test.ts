import { describe, it, expect } from 'vitest';
import { friendlyError } from './supabaseErrors';

describe('friendlyError', () => {
  it('neutralizes already registered error to prevent account enumeration', () => {
    const err = new Error('User already registered');
    const result = friendlyError(err);
    expect(result).toBe(
      'Unable to complete registration with this email. If you already have an account, please sign in or reset your password.'
    );
    expect(result).not.toContain('already in use');
  });

  it('handles invalid login credentials', () => {
    const err = { message: 'Invalid login credentials' };
    expect(friendlyError(err)).toBe('Incorrect email or password.');
  });

  it('translates RLS violations into actionable plant-access guidance', () => {
    const err = new Error('new row violates row-level security policy for table "wells"');
    const result = friendlyError(err);
    expect(result).toContain('Admin Console → Employees');
  });

  it('translates rate limit errors with seconds', () => {
    const err = { message: 'For security purposes, you can only request this after 60 seconds.' };
    expect(friendlyError(err)).toBe('Please wait about 60 seconds before requesting another code.');
  });
});
