// pattern: Functional Core

import { describe, it, expect } from 'bun:test';
import { stripQuotedContent } from './strip-quotes';

describe('loop-detection.AC7.3: Quoted content stripping', () => {
  describe('fenced code blocks', () => {
    it('removes fenced code blocks entirely', () => {
      const input = 'Here is some code:\n```\nconst x = 5;\n```\nDone.';
      const result = stripQuotedContent(input);
      expect(result).toBe('Here is some code:\nDone.');
    });

    it('removes multiple fenced code blocks', () => {
      const input = 'First:\n```\ncode1\n```\nMiddle:\n```\ncode2\n```\nEnd.';
      const result = stripQuotedContent(input);
      expect(result).toBe('First:\nMiddle:\nEnd.');
    });

    it('handles empty code fences', () => {
      const input = 'Before.\n```\n```\nAfter.';
      const result = stripQuotedContent(input);
      expect(result).toBe('Before.\nAfter.');
    });

    it('handles code fences with varied whitespace', () => {
      const input = 'Text\n```   \n   code   \n   ```\nMore text.';
      const result = stripQuotedContent(input);
      expect(result).toBe('Text\nMore text.');
    });
  });

  describe('blockquotes (> prefix)', () => {
    it('removes lines starting with >', () => {
      const input = '> This is quoted\nThis is not\n> This is also quoted';
      const result = stripQuotedContent(input);
      expect(result).toBe('This is not');
    });

    it('removes blockquote with leading whitespace', () => {
      const input = 'Normal text\n > Quoted with space\nMore normal';
      const result = stripQuotedContent(input);
      expect(result).toBe('Normal text\nMore normal');
    });

    it('preserves > in middle of line', () => {
      const input = 'The comparison 5 > 3 is true';
      const result = stripQuotedContent(input);
      expect(result).toBe('The comparison 5 > 3 is true');
    });

    it('handles multiple consecutive blockquotes', () => {
      const input = '> Quote 1\n> Quote 2\n> Quote 3\nNormal line';
      const result = stripQuotedContent(input);
      expect(result).toBe('Normal line');
    });
  });

  describe('mixed quoted and non-quoted content', () => {
    it('AC7.3: user message echo with quoted content', () => {
      const input = 'Here is my response.\n> User said: hello\n> More context\nMy actual response here.';
      const result = stripQuotedContent(input);
      expect(result).toBe('Here is my response.\nMy actual response here.');
    });

    it('code blocks within normal text', () => {
      const input = 'Here is a function:\n```typescript\nfunction foo() {}\n```\nThat is the function.';
      const result = stripQuotedContent(input);
      expect(result).toBe('Here is a function:\nThat is the function.');
    });

    it('both blockquotes and code blocks', () => {
      const input = 'Start\n> Quoted\n```\nCode\n```\nEnd';
      const result = stripQuotedContent(input);
      expect(result).toBe('Start\nEnd');
    });
  });

  describe('newline collapsing', () => {
    it('collapses multiple consecutive newlines', () => {
      const input = 'Line 1\n\n\n\nLine 2';
      const result = stripQuotedContent(input);
      expect(result).toBe('Line 1\nLine 2');
    });

    it('preserves single newlines', () => {
      const input = 'Line 1\nLine 2\nLine 3';
      const result = stripQuotedContent(input);
      expect(result).toBe('Line 1\nLine 2\nLine 3');
    });

    it('collapses multiple newlines from removed blockquotes', () => {
      const input = 'Text\n> Quote\n> Quote\n> Quote\nMore text';
      const result = stripQuotedContent(input);
      expect(result).toBe('Text\nMore text');
    });

    it('collapses multiple newlines from removed code blocks', () => {
      const input = 'Start\n```\ncode\n```\nEnd';
      const result = stripQuotedContent(input);
      expect(result).toBe('Start\nEnd');
    });
  });

  describe('whitespace trimming', () => {
    it('trims leading whitespace', () => {
      const input = '   Some content';
      const result = stripQuotedContent(input);
      expect(result).toBe('Some content');
    });

    it('trims trailing whitespace', () => {
      const input = 'Some content   ';
      const result = stripQuotedContent(input);
      expect(result).toBe('Some content');
    });

    it('trims both leading and trailing', () => {
      const input = '   Some content   ';
      const result = stripQuotedContent(input);
      expect(result).toBe('Some content');
    });

    it('preserves internal whitespace', () => {
      const input = 'Text   with   internal   spaces';
      const result = stripQuotedContent(input);
      expect(result).toBe('Text   with   internal   spaces');
    });
  });

  describe('edge cases', () => {
    it('empty string returns empty string', () => {
      const result = stripQuotedContent('');
      expect(result).toBe('');
    });

    it('only whitespace returns empty string', () => {
      const result = stripQuotedContent('   \n\n   ');
      expect(result).toBe('');
    });

    it('only blockquotes returns empty string', () => {
      const input = '> Quote 1\n> Quote 2';
      const result = stripQuotedContent(input);
      expect(result).toBe('');
    });

    it('only code blocks returns empty string', () => {
      const input = '```\ncode\n```';
      const result = stripQuotedContent(input);
      expect(result).toBe('');
    });

    it('preserves intentional newlines in agent-generated content', () => {
      const input = 'Step 1: Do this\nStep 2: Do that\nStep 3: Final step';
      const result = stripQuotedContent(input);
      expect(result).toBe('Step 1: Do this\nStep 2: Do that\nStep 3: Final step');
    });

    it('non-quoted content is preserved intact', () => {
      const input = 'I am providing a detailed response with multiple sentences. This is agent-generated. It should all be preserved.';
      const result = stripQuotedContent(input);
      expect(result).toBe('I am providing a detailed response with multiple sentences. This is agent-generated. It should all be preserved.');
    });
  });

  describe('complex realistic examples', () => {
    it('agent response with user echo and quoted content', () => {
      const input = `I understand your request.

> You asked: "How do I do X?"
> Context: You mentioned Y before

Here is my solution:
1. First step
2. Second step

\`\`\`typescript
const result = doSomething();
\`\`\`

That should work for you.`;

      const result = stripQuotedContent(input);
      expect(result).toContain('I understand your request.');
      expect(result).toContain('Here is my solution:');
      expect(result).toContain('1. First step');
      expect(result).toContain('2. Second step');
      expect(result).toContain('That should work for you.');
      expect(result).not.toContain('You asked');
      expect(result).not.toContain('const result');
    });

    it('step-by-step instructions should be preserved', () => {
      const input = `Follow these steps:

Step 1: Install the package
- Run: npm install

Step 2: Configure it
- Edit the config file

Step 3: Use it
- Call the function`;

      const result = stripQuotedContent(input);
      expect(result).toContain('Step 1:');
      expect(result).toContain('Step 2:');
      expect(result).toContain('Step 3:');
      expect(result).toContain('npm install');
    });
  });
});
