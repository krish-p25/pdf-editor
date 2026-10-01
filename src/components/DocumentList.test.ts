import { describe, it, expect } from 'vitest';
import { describeSaved } from './DocumentList';

const NOW = new Date('2026-10-01T12:00:00Z').getTime();
const ago = (ms: number) => NOW - ms;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('describeSaved', () => {
  it('says "just now" for the last minute', () => {
    expect(describeSaved(ago(5 * SECOND), NOW)).toBe('just now');
  });

  it('counts minutes, singular and plural', () => {
    expect(describeSaved(ago(1 * MINUTE), NOW)).toBe('1 minute ago');
    expect(describeSaved(ago(5 * MINUTE), NOW)).toBe('5 minutes ago');
  });

  it('counts hours', () => {
    expect(describeSaved(ago(1 * HOUR), NOW)).toBe('1 hour ago');
    expect(describeSaved(ago(3 * HOUR), NOW)).toBe('3 hours ago');
  });

  it('says yesterday for a day ago', () => {
    expect(describeSaved(ago(1 * DAY), NOW)).toBe('yesterday');
  });

  it('counts days within the week', () => {
    expect(describeSaved(ago(3 * DAY), NOW)).toBe('3 days ago');
  });

  it('falls back to a date beyond a week', () => {
    const out = describeSaved(ago(30 * DAY), NOW);
    expect(out).not.toMatch(/ago|just now|yesterday/);
    expect(out.length).toBeGreaterThan(0);
  });

  it('does not produce a negative age when the clock has drifted', () => {
    // A document saved "in the future" relative to now must not read
    // "-3 minutes ago".
    expect(describeSaved(NOW + 5 * MINUTE, NOW)).toBe('just now');
  });
});
