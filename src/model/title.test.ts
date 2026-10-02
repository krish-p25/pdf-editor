import { describe, it, expect } from 'vitest';
import { exportFileName, normaliseTitle, titleFromFileName } from './title';

describe('titleFromFileName', () => {
  it('drops the .pdf extension', () => {
    expect(titleFromFileName('report.pdf')).toBe('report');
  });

  it('is case-insensitive about the extension', () => {
    expect(titleFromFileName('Report.PDF')).toBe('Report');
  });

  it('keeps dots that are part of the name', () => {
    expect(titleFromFileName('2026.Q1.summary.pdf')).toBe('2026.Q1.summary');
  });

  it('leaves a name with no extension alone', () => {
    expect(titleFromFileName('scan')).toBe('scan');
  });

  it('falls back for an empty name', () => {
    expect(titleFromFileName('')).toBe('Untitled');
    expect(titleFromFileName('.pdf')).toBe('Untitled');
  });
});

describe('normaliseTitle', () => {
  it('trims surrounding whitespace', () => {
    expect(normaliseTitle('  Contract  ')).toBe('Contract');
  });

  it('falls back when the user clears the field', () => {
    expect(normaliseTitle('')).toBe('Untitled');
    expect(normaliseTitle('   ')).toBe('Untitled');
  });

  it('caps absurdly long titles', () => {
    expect(normaliseTitle('x'.repeat(500)).length).toBe(200);
  });
});

describe('exportFileName', () => {
  it('appends .pdf', () => {
    expect(exportFileName('Quarterly report')).toBe('Quarterly report.pdf');
  });

  it('replaces characters a filesystem would reject', () => {
    // A title is free text; a filename is not.
    expect(exportFileName('Q1/Q2: results')).toBe('Q1-Q2- results.pdf');
  });

  it('strips control characters', () => {
    expect(exportFileName('report\u0001name')).toBe('report-name.pdf');
  });

  it('collapses runs of whitespace', () => {
    expect(exportFileName('a    b')).toBe('a b.pdf');
  });

  it('falls back when nothing usable survives', () => {
    expect(exportFileName('///')).toBe('Untitled.pdf');
    expect(exportFileName('   ')).toBe('Untitled.pdf');
  });

  it('never produces a name that is only an extension', () => {
    expect(exportFileName('')).not.toBe('.pdf');
  });
});
