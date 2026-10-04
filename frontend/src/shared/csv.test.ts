import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { escapeCSVField, generateCSVString, downloadCSV, downloadCSVMatrix } from './csv';

describe('CSV Security and Utility (csv.ts)', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('escapes CSV formula injection prefixes (=, +, -, @, \\t, \\r, |, %)', () => {
    expect(escapeCSVField('=cmd|"/C calc"!A0')).toBe('"\'=cmd|""/C calc""!A0"');
    expect(escapeCSVField('+1+2')).toBe("'+1+2");
    expect(escapeCSVField('-5+10')).toBe("'-5+10");
    expect(escapeCSVField('@SUM(1,2)')).toBe('"\'@SUM(1,2)"');
    expect(escapeCSVField('\tmalicious')).toBe("'\tmalicious");
    expect(escapeCSVField('\rmalicious')).toBe('"\'\rmalicious"');
    expect(escapeCSVField('|calc')).toBe("'|calc");
    expect(escapeCSVField('%username%')).toBe("'%username%");
  });

  it('handles quotes, commas, and newlines safely', () => {
    expect(escapeCSVField('hello, world')).toBe('"hello, world"');
    expect(escapeCSVField('hello "world"')).toBe('"hello ""world"""');
    expect(escapeCSVField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCSVField(null)).toBe('');
    expect(escapeCSVField(undefined)).toBe('');
    expect(escapeCSVField(123)).toBe('123');
  });

  it('generates well-formatted CSV strings with header and rows', () => {
    const headers = ['Name', 'Role', 'Formula'];
    const rows = [
      ['Alice', 'Operator', '=1+1'],
      ['Bob, Jr.', 'Manager', 'Normal'],
    ];
    const result = generateCSVString(headers, rows);
    expect(result).toBe('Name,Role,Formula\r\nAlice,Operator,\'=1+1\r\n"Bob, Jr.",Manager,Normal');
  });

  it('triggers download for record-based CSV', () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');

    downloadCSV('test-export', [
      { Plant: 'Plant A', Flow: 150.5 },
      { Plant: 'Plant B', Flow: 200.0 },
    ]);

    expect(appendSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
  });

  it('triggers download for matrix-based CSV', () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');

    downloadCSVMatrix('matrix-export', ['Col1', 'Col2'], [['Val1', 'Val2']]);

    expect(appendSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
  });
});
