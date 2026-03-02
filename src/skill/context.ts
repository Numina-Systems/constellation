// pattern: Functional Core

/**
 * Formatting utilities for injecting skill definitions into system prompts.
 * Converts skill definitions into a structured markdown section with metadata and companions.
 */

import type { SkillDefinition } from './types.ts';

/**
 * Format an array of skill definitions into a system prompt section.
 * Skill names are used as H3 headings, bodies as content, and companions as H4 subsections.
 * Returns undefined if the skills array is empty (no section needed).
 *
 * Respects the order of the input array (caller is responsible for sorting by relevance).
 */
export function formatSkillsSection(skills: ReadonlyArray<SkillDefinition>): string | undefined {
  if (skills.length === 0) return undefined;

  const sections = skills.map((skill) => {
    const parts = [`### ${skill.metadata.name}\n\n${skill.body}`];
    for (const companion of skill.companions) {
      parts.push(`\n\n#### ${companion.name}\n\n${companion.content}`);
    }
    return parts.join('');
  });

  return `## Active Skills\n\n${sections.join('\n\n---\n\n')}`;
}
