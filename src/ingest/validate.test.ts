import { describe, it, expect } from 'bun:test';
import { resolve } from 'node:path';
import { validateIngestPath, validateFileSize } from './validate';

describe('validateIngestPath', () => {
  const workspaceRoot = '/home/user/workspace';

  it('accepts valid relative paths within workspace', () => {
    const result = validateIngestPath('docs/guide.md', workspaceRoot);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.resolvedPath).toBe(
        resolve(workspaceRoot, 'docs/guide.md'),
      );
    }
  });

  it('accepts flat filenames', () => {
    const result = validateIngestPath('README.md', workspaceRoot);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.resolvedPath).toBe(resolve(workspaceRoot, 'README.md'));
    }
  });

  it('accepts deeply nested paths', () => {
    const result = validateIngestPath(
      'docs/project/implementation/guide.md',
      workspaceRoot,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.resolvedPath).toBe(
        resolve(workspaceRoot, 'docs/project/implementation/guide.md'),
      );
    }
  });

  it('rejects path traversal with ../', () => {
    const result = validateIngestPath('../other/file.md', workspaceRoot);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('path traversal rejected');
      expect(result.error).toContain('../other/file.md');
    }
  });

  it('rejects multiple path traversal attempts', () => {
    const result = validateIngestPath('../../etc/passwd', workspaceRoot);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('path traversal rejected');
    }
  });

  it('rejects absolute paths outside workspace', () => {
    const result = validateIngestPath('/etc/passwd', workspaceRoot);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('path traversal rejected');
    }
  });

  it('rejects binary file extensions (.png)', () => {
    const result = validateIngestPath('images/photo.png', workspaceRoot);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('binary file rejected');
      expect(result.error).toContain('.png');
    }
  });

  it('rejects binary file extensions (.pdf)', () => {
    const result = validateIngestPath('documents/report.pdf', workspaceRoot);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('binary file rejected');
      expect(result.error).toContain('.pdf');
    }
  });

  it('rejects archive extensions (.zip)', () => {
    const result = validateIngestPath('archives/data.zip', workspaceRoot);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('binary file rejected');
      expect(result.error).toContain('.zip');
    }
  });

  it('rejects executable extensions (.exe)', () => {
    const result = validateIngestPath('bin/program.exe', workspaceRoot);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('binary file rejected');
      expect(result.error).toContain('.exe');
    }
  });

  it('rejects media extensions (.mp4)', () => {
    const result = validateIngestPath('videos/demo.mp4', workspaceRoot);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('binary file rejected');
    }
  });

  it('accepts text file extensions (.txt)', () => {
    const result = validateIngestPath('notes.txt', workspaceRoot);
    expect(result.valid).toBe(true);
  });

  it('accepts markdown extensions (.md)', () => {
    const result = validateIngestPath('README.md', workspaceRoot);
    expect(result.valid).toBe(true);
  });

  it('is case-insensitive for binary extension detection', () => {
    const resultLower = validateIngestPath('image.png', workspaceRoot);
    const resultUpper = validateIngestPath('image.PNG', workspaceRoot);
    expect(resultLower.valid).toBe(false);
    expect(resultUpper.valid).toBe(false);
  });
});

describe('validateFileSize', () => {
  it('accepts files under 1MB', () => {
    const result = validateFileSize(1024 * 100, 'document.md'); // 100KB
    expect(result.valid).toBe(true);
  });

  it('accepts files exactly 1MB', () => {
    const result = validateFileSize(1_048_576, 'document.md');
    expect(result.valid).toBe(true);
  });

  it('rejects files over 1MB', () => {
    const result = validateFileSize(1_048_576 + 1, 'document.md');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('file too large');
      expect(result.error).toContain('document.md');
      expect(result.error).toContain('MB');
    }
  });

  it('rejects files 2MB', () => {
    const result = validateFileSize(2 * 1_048_576, 'large.md');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('file too large');
      expect(result.error).toContain('2.00MB');
    }
  });

  it('provides human-readable size in error message', () => {
    const result = validateFileSize(1_572_864, 'file.md'); // 1.5MB
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('1.50MB');
    }
  });

  it('accepts zero-size files', () => {
    const result = validateFileSize(0, 'empty.md');
    expect(result.valid).toBe(true);
  });
});
