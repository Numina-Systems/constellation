// pattern: Functional Core

/**
 * Path and file validation for ingestion.
 * Validates workspace boundary traversal and file type/size constraints.
 */

import { resolve, relative, extname } from 'node:path';

export type ValidationResult =
  | { valid: true; resolvedPath: string }
  | { valid: false; error: string };

export type FileSizeResult =
  | { valid: true }
  | { valid: false; error: string };

const MAX_FILE_SIZE = 1_048_576; // 1MB

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.webp',
  '.svg',
  '.mp3',
  '.mp4',
  '.wav',
  '.avi',
  '.mov',
  '.mkv',
  '.zip',
  '.tar',
  '.gz',
  '.7z',
  '.rar',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.dat',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
]);

/**
 * Validate that a file path stays within workspace root and is not a binary file.
 *
 * @param filePath - File path relative to workspace root
 * @param workspaceRoot - Workspace root directory
 * @returns ValidationResult with resolved path or error
 */
export function validateIngestPath(filePath: string, workspaceRoot: string): ValidationResult {
  const resolved = resolve(workspaceRoot, filePath);
  const rel = relative(workspaceRoot, resolved);

  // Check for path traversal above workspace root
  if (rel.startsWith('..')) {
    return {
      valid: false,
      error: `path traversal rejected: "${filePath}" resolves outside workspace root`,
    };
  }

  // Check for binary file extensions
  const ext = extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `binary file rejected: "${filePath}" (extension: ${ext})`,
    };
  }

  return { valid: true, resolvedPath: resolved };
}

/**
 * Validate that a file size does not exceed the maximum allowed.
 *
 * @param sizeBytes - File size in bytes
 * @param filePath - File path for error messages
 * @returns FileSizeResult with error if too large
 */
export function validateFileSize(sizeBytes: number, filePath: string): FileSizeResult {
  if (sizeBytes > MAX_FILE_SIZE) {
    const sizeInMB = (sizeBytes / 1_048_576).toFixed(2);
    return {
      valid: false,
      error: `file too large: "${filePath}" is ${sizeInMB}MB (max 1MB)`,
    };
  }
  return { valid: true };
}
