// pattern: Functional Core

import { describe, it, expect } from 'bun:test';
import {
  DEFAULT_SUMMARIZATION_PROMPT,
  interpolatePrompt,
} from './prompt.js';

describe('prompt interpolation', () => {
  describe('DEFAULT_SUMMARIZATION_PROMPT', () => {
    it('contains all three required placeholders', () => {
      expect(DEFAULT_SUMMARIZATION_PROMPT).toContain('{persona}');
      expect(DEFAULT_SUMMARIZATION_PROMPT).toContain('{existing_summary}');
      expect(DEFAULT_SUMMARIZATION_PROMPT).toContain('{messages}');
    });
  });

  describe('interpolatePrompt', () => {
    const baseTemplate = 'Persona: {persona}\nSummary: {existing_summary}\nMessages: {messages}';

    it('replaces all three placeholders with provided values', () => {
      const result = interpolatePrompt({
        template: baseTemplate,
        persona: 'Alice',
        existingSummary: 'Previous context',
        messages: 'Hello world',
      });

      expect(result).toContain('Persona: Alice');
      expect(result).toContain('Summary: Previous context');
      expect(result).toContain('Messages: Hello world');
    });

    it('replaces empty persona with empty string', () => {
      const result = interpolatePrompt({
        template: baseTemplate,
        persona: '',
        existingSummary: 'Previous context',
        messages: 'Hello world',
      });

      expect(result).toBe(
        'Persona: \nSummary: Previous context\nMessages: Hello world',
      );
    });

    it('replaces empty existing summary with "(no prior summary)"', () => {
      const result = interpolatePrompt({
        template: baseTemplate,
        persona: 'Alice',
        existingSummary: '',
        messages: 'Hello world',
      });

      expect(result).toContain('Summary: (no prior summary)');
    });

    it('replaces empty messages with empty string', () => {
      const result = interpolatePrompt({
        template: baseTemplate,
        persona: 'Alice',
        existingSummary: 'Previous context',
        messages: '',
      });

      expect(result).toBe(
        'Persona: Alice\nSummary: Previous context\nMessages: ',
      );
    });

    it('replaces multiple occurrences of same placeholder', () => {
      const template = 'First: {persona} - Second: {persona}';
      const result = interpolatePrompt({
        template,
        persona: 'Bob',
        existingSummary: '',
        messages: '',
      });

      expect(result).toBe('First: Bob - Second: Bob');
    });

    it('returns template unchanged when no placeholders present', () => {
      const template = 'This is a template without placeholders';
      const result = interpolatePrompt({
        template,
        persona: 'Alice',
        existingSummary: 'Summary',
        messages: 'Messages',
      });

      expect(result).toBe(template);
    });

    it('accepts custom template and interpolates it correctly (AC6.3)', () => {
      const customTemplate = 'Custom template:\nAgent: {persona}\nHistory: {messages}';
      const result = interpolatePrompt({
        template: customTemplate,
        persona: 'Charlie',
        existingSummary: 'Ignored',
        messages: 'Some messages',
      });

      expect(result).toContain('Agent: Charlie');
      expect(result).toContain('History: Some messages');
      expect(result).not.toContain('Ignored');
    });

    it('correctly interpolates DEFAULT_SUMMARIZATION_PROMPT with all values (AC6.4)', () => {
      const result = interpolatePrompt({
        template: DEFAULT_SUMMARIZATION_PROMPT,
        persona: 'TestAgent',
        existingSummary: 'Previous work summary',
        messages: 'User: hello\nAssistant: hi',
      });

      expect(result).toContain('TestAgent');
      expect(result).toContain('Previous work summary');
      expect(result).toContain('User: hello\nAssistant: hi');
      expect(result).not.toContain('{persona}');
      expect(result).not.toContain('{existing_summary}');
      expect(result).not.toContain('{messages}');
    });

    it('handles whitespace in placeholder values', () => {
      const template = 'Persona: [{persona}]\nSummary: [{existing_summary}]';
      const result = interpolatePrompt({
        template,
        persona: '  Agent  ',
        existingSummary: '  History  ',
        messages: '',
      });

      expect(result).toContain('[  Agent  ]');
      expect(result).toContain('[  History  ]');
    });
  });
});
