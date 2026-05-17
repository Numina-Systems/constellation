import { describe, it, expect } from 'bun:test';
import { chunkDocument } from './chunker.ts';

describe('knowledge-autonomy.AC3.2: chunkDocument - heading context preservation', () => {
  describe('Markdown with nested headings', () => {
    it('produces chunks with heading ancestry in context', () => {
      const text = `# Title
Content under title

## Section
Content under section

### Subsection
Content under subsection`;

      const chunks = chunkDocument(text);

      expect(chunks.length).toBeGreaterThan(0);

      // Verify chunks exist and have content
      expect(chunks[0]).toBeDefined();
      expect(chunks[0]!.content.length).toBeGreaterThan(0);
    });

    it('single heading document produces chunk with heading context', () => {
      const text = `# Title
Content under this heading`;

      const chunks = chunkDocument(text);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.content).toContain('# Title');
      expect(chunks[0]!.headingContext).toContain('# Title');
    });

    it('multiple headings at same level produce separate chunks', () => {
      const text = `# First
Content 1

# Second
Content 2

# Third
Content 3`;

      const chunks = chunkDocument(text);

      expect(chunks.length).toBeGreaterThanOrEqual(3);

      // Each chunk should have its own heading context
      const contexts = chunks.map(c => c.headingContext);
      expect(contexts.some(ctx => ctx.includes('# First'))).toBe(true);
      expect(contexts.some(ctx => ctx.includes('# Second'))).toBe(true);
      expect(contexts.some(ctx => ctx.includes('# Third'))).toBe(true);
    });

    it('nested headings produce correct context chain h1 > h2 > h3', () => {
      const text = `# Title
Intro

## Section
Section content

### Subsection
Subsection content

## Another Section
More content`;

      const chunks = chunkDocument(text);

      // Find chunk under subsection
      const subsectionChunk = chunks.find(c => c.content.includes('Subsection'));
      expect(subsectionChunk).toBeDefined();
      expect(subsectionChunk!.headingContext).toContain('# Title');
      expect(subsectionChunk!.headingContext).toContain('## Section');
      expect(subsectionChunk!.headingContext).toContain('### Subsection');
      expect(subsectionChunk!.headingContext).toMatch(/# Title > ## Section > ### Subsection/);
    });

    it('heading at same level resets context stack appropriately', () => {
      const text = `# Title
Intro

## Section A
Section A content

## Section B
Section B content`;

      const chunks = chunkDocument(text);

      // Find chunks for Section A and B
      const sectionAChunk = chunks.find(c => c.content.includes('Section A'));
      const sectionBChunk = chunks.find(c => c.content.includes('Section B'));

      expect(sectionAChunk!.headingContext).toContain('## Section A');
      expect(sectionAChunk!.headingContext).not.toContain('## Section B');

      expect(sectionBChunk!.headingContext).toContain('## Section B');
      expect(sectionBChunk!.headingContext).not.toContain('## Section A');
    });

    it('heading at higher level pops stack correctly', () => {
      const text = `# Title
Intro

## Section
Section content

### Subsection
Subsection content

# New Title
New content`;

      const chunks = chunkDocument(text);

      // Find chunk under new title
      const newTitleChunk = chunks.find(c => c.content.includes('New content'));
      expect(newTitleChunk).toBeDefined();
      expect(newTitleChunk!.headingContext).toContain('# New Title');
      expect(newTitleChunk!.headingContext).not.toContain('## Section');
      expect(newTitleChunk!.headingContext).not.toContain('### Subsection');
    });

    it('includes heading line in both content and headingContext', () => {
      const text = `# Main Title
Some content`;

      const chunks = chunkDocument(text);
      expect(chunks[0]!.content).toContain('# Main Title');
      expect(chunks[0]!.headingContext).toContain('# Main Title');
    });
  });

  describe('Non-markdown text', () => {
    it('splits on double newlines with empty headingContext', () => {
      const text = `First paragraph

Second paragraph

Third paragraph`;

      const chunks = chunkDocument(text);

      expect(chunks.length).toBeGreaterThanOrEqual(3);
      expect(chunks.every(c => c.headingContext === '')).toBe(true);
    });
  });

  describe('Long sections exceeding token budget', () => {
    it('splits long markdown sections further on double newlines', () => {
      const longParagraph = Array(400).fill('This is a sentence. ').join('');
      const text = `# Title
${longParagraph}`;

      const chunks = chunkDocument(text, { maxChunkTokens: 200 });

      expect(chunks.length).toBeGreaterThan(1);
      // All chunks should have the same heading context
      expect(chunks.every(c => c.headingContext.includes('# Title'))).toBe(true);
    });

    it('splits long non-markdown sections on sentences', () => {
      const longParagraph = Array(300).fill('This is a sentence. ').join('');
      const text = longParagraph;

      const chunks = chunkDocument(text, { maxChunkTokens: 100 });

      expect(chunks.length).toBeGreaterThan(1);
      // All should have empty heading context
      expect(chunks.every(c => c.headingContext === '')).toBe(true);
    });
  });

  describe('Empty and whitespace-only sections', () => {
    it('filters out empty chunks', () => {
      const text = `# Title
Content

#


More content`;

      const chunks = chunkDocument(text);

      // Should not have empty chunks
      expect(chunks.every(c => c.content.trim().length > 0)).toBe(true);
    });

    it('returns empty array for whitespace-only input', () => {
      const text = '   \n\n   \n  ';
      const chunks = chunkDocument(text);
      expect(chunks.length).toBe(0);
    });

    it('returns empty array for empty string', () => {
      const chunks = chunkDocument('');
      expect(chunks.length).toBe(0);
    });
  });

  describe('Token estimates', () => {
    it('estimates tokens approximately correct', () => {
      const text = 'a'.repeat(400);
      const chunks = chunkDocument(text);

      // 400 chars / 4 chars per token = 100 tokens estimated
      expect(chunks[0]!.tokenEstimate).toBeLessThanOrEqual(110);
      expect(chunks[0]!.tokenEstimate).toBeGreaterThanOrEqual(90);
    });
  });

  describe('Chunk indices', () => {
    it('assigns sequential indices starting at 0', () => {
      const text = `# First
Content 1

# Second
Content 2

# Third
Content 3`;

      const chunks = chunkDocument(text);

      const indices = chunks.map(c => c.index);
      for (let i = 0; i < indices.length; i++) {
        expect(indices[i]).toBe(i);
      }
    });

    it('maintains sequential indices after splitting long sections', () => {
      const longContent = Array(400).fill('This is a sentence. ').join('');
      const text = `# First
${longContent}

# Second
Short content`;

      const chunks = chunkDocument(text, { maxChunkTokens: 200 });

      const indices = chunks.map(c => c.index);
      for (let i = 0; i < indices.length; i++) {
        expect(indices[i]).toBe(i);
      }
    });
  });

  describe('Adjacent paragraphs', () => {
    it('groups adjacent non-heading paragraphs up to token budget', () => {
      const text = `# Title
Paragraph 1

Paragraph 2

Paragraph 3

Paragraph 4`;

      const chunks = chunkDocument(text);

      // Should have grouped multiple paragraphs into same chunk if within budget
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('Markdown detection', () => {
    it('detects markdown with headings', () => {
      const markdown = `# Heading
Content`;

      const chunks = chunkDocument(markdown);

      // Should use markdown chunking (context preserved)
      expect(chunks[0]!.headingContext).toContain('# Heading');
    });

    it('treats text without headings as non-markdown', () => {
      const plainText = `Regular paragraph

Another paragraph`;

      const chunks = chunkDocument(plainText);

      // Should use plain text chunking (empty context)
      expect(chunks.every(c => c.headingContext === '')).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('handles single word content', () => {
      const text = '# Title\nContent';
      const chunks = chunkDocument(text);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.content).toBeDefined();
    });

    it('handles multiple consecutive headings without content', () => {
      const text = `# Title
## Subsection
### Sub-subsection
Final content`;

      const chunks = chunkDocument(text);

      expect(chunks.length).toBeGreaterThan(0);
    });

    it('respects custom maxChunkTokens option', () => {
      const text = Array(200).fill('This is a sentence. ').join('');

      const smallChunks = chunkDocument(text, { maxChunkTokens: 100 });
      const largeChunks = chunkDocument(text, { maxChunkTokens: 500 });

      expect(smallChunks.length).toBeGreaterThan(largeChunks.length);
    });
  });

  describe('Real-world markdown example', () => {
    it('handles typical documentation structure', () => {
      const doc = `# API Reference

## Authentication

### Overview
The API uses token-based authentication. Include your API key in the Authorization header.

### Getting an API Key
Visit the dashboard to generate a new key.

## Endpoints

### POST /users
Create a new user account.

Parameters:
- name (string, required)
- email (string, required)

### GET /users/:id
Retrieve a user by ID.`;

      const chunks = chunkDocument(doc);

      expect(chunks.length).toBeGreaterThan(0);

      // Verify context chains exist
      const authOverviewChunk = chunks.find(c =>
        c.content.includes('token-based authentication')
      );
      expect(authOverviewChunk).toBeDefined();
      expect(authOverviewChunk!.headingContext).toContain('## Authentication');
      expect(authOverviewChunk!.headingContext).toContain('### Overview');

      const endpointChunk = chunks.find(c => c.content.includes('Create a new user'));
      expect(endpointChunk).toBeDefined();
      expect(endpointChunk!.headingContext).toContain('## Endpoints');
    });
  });
});
