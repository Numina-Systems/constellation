import {describe, test, expect} from 'bun:test';
import {classifyEvent, formatEventContent, isHighPriority} from './events';
import type {SpaceMoltEvent} from './types';

describe('classifyEvent', () => {
  test('classifies combat_update as high priority', () => {
    expect(classifyEvent('combat_update')).toBe('high');
  });

  test('classifies player_died as high priority', () => {
    expect(classifyEvent('player_died')).toBe('high');
  });

  test('classifies trade_offer_received as high priority', () => {
    expect(classifyEvent('trade_offer_received')).toBe('high');
  });

  test('classifies scan_detected as high priority', () => {
    expect(classifyEvent('scan_detected')).toBe('high');
  });

  test('classifies pilotless_ship as high priority', () => {
    expect(classifyEvent('pilotless_ship')).toBe('high');
  });

  test('classifies chat_message as normal priority', () => {
    expect(classifyEvent('chat_message')).toBe('normal');
  });

  test('classifies mining_yield as normal priority', () => {
    expect(classifyEvent('mining_yield')).toBe('normal');
  });

  test('classifies skill_level_up as normal priority', () => {
    expect(classifyEvent('skill_level_up')).toBe('normal');
  });

  test('classifies tick as internal', () => {
    expect(classifyEvent('tick')).toBe('internal');
  });

  test('classifies welcome as internal', () => {
    expect(classifyEvent('welcome')).toBe('internal');
  });

  test('classifies logged_in as internal', () => {
    expect(classifyEvent('logged_in')).toBe('internal');
  });

  test('classifies unknown event as normal', () => {
    expect(classifyEvent('some_unknown_event')).toBe('normal');
  });
});

describe('isHighPriority', () => {
  test('returns true for combat_update', () => {
    expect(isHighPriority('combat_update')).toBe(true);
  });

  test('returns true for player_died', () => {
    expect(isHighPriority('player_died')).toBe(true);
  });

  test('returns true for trade_offer_received', () => {
    expect(isHighPriority('trade_offer_received')).toBe(true);
  });

  test('returns true for scan_detected', () => {
    expect(isHighPriority('scan_detected')).toBe(true);
  });

  test('returns true for pilotless_ship', () => {
    expect(isHighPriority('pilotless_ship')).toBe(true);
  });

  test('returns false for chat_message', () => {
    expect(isHighPriority('chat_message')).toBe(false);
  });

  test('returns false for mining_yield', () => {
    expect(isHighPriority('mining_yield')).toBe(false);
  });

  test('returns false for skill_level_up', () => {
    expect(isHighPriority('skill_level_up')).toBe(false);
  });

  test('returns false for tick', () => {
    expect(isHighPriority('tick')).toBe(false);
  });

  test('returns false for unknown event', () => {
    expect(isHighPriority('unknown')).toBe(false);
  });
});

describe('formatEventContent', () => {
  test('formats combat_update event', () => {
    const event: SpaceMoltEvent = {
      type: 'combat_update',
      payload: {
        attacker: 'PlayerX',
        target: 'PlayerY',
        damage: 45,
        damage_type: 'kinetic',
      },
    };

    const content = formatEventContent(event);

    expect(content).toContain('Combat:');
    expect(content).toContain('PlayerX');
    expect(content).toContain('PlayerY');
    expect(content).toContain('45');
    expect(content).toContain('kinetic');
  });

  test('formats player_died event', () => {
    const event: SpaceMoltEvent = {
      type: 'player_died',
      payload: {
        killer_name: 'EnemyX',
        respawn_base: 'Base Alpha',
      },
    };

    const content = formatEventContent(event);

    expect(content).toContain('Death:');
    expect(content).toContain('EnemyX');
    expect(content).toContain('Base Alpha');
  });

  test('formats chat_message event', () => {
    const event: SpaceMoltEvent = {
      type: 'chat_message',
      payload: {
        channel: 'general',
        sender: 'Alice',
        content: 'Hello everyone',
      },
    };

    const content = formatEventContent(event);

    expect(content).toContain('Chat');
    expect(content).toContain('general');
    expect(content).toContain('Alice');
    expect(content).toContain('Hello everyone');
  });

  test('formats trade_offer_received event', () => {
    const event: SpaceMoltEvent = {
      type: 'trade_offer_received',
      payload: {
        offerer_name: 'Merchant Bob',
        offer_credits: 5000,
      },
    };

    const content = formatEventContent(event);

    expect(content).toContain('Trade offer');
    expect(content).toContain('Merchant Bob');
    expect(content).toContain('5000');
  });

  test('formats mining_yield event', () => {
    const event: SpaceMoltEvent = {
      type: 'mining_yield',
      payload: {
        quantity: 150,
        resource_name: 'iron ore',
        remaining: 2500,
      },
    };

    const content = formatEventContent(event);

    expect(content).toContain('Mined');
    expect(content).toContain('150');
    expect(content).toContain('iron ore');
    expect(content).toContain('2500');
  });

  test('formats scan_detected event', () => {
    const event: SpaceMoltEvent = {
      type: 'scan_detected',
      payload: {
        scanner_username: 'Scanner User',
      },
    };

    const content = formatEventContent(event);

    expect(content).toContain('Scan detected');
    expect(content).toContain('Scanner User');
  });

  test('formats skill_level_up event', () => {
    const event: SpaceMoltEvent = {
      type: 'skill_level_up',
      payload: {
        skill_id: 'piloting',
        new_level: 5,
      },
    };

    const content = formatEventContent(event);

    expect(content).toContain('Skill up');
    expect(content).toContain('piloting');
    expect(content).toContain('5');
  });

  test('formats unknown event with default message', () => {
    const event: SpaceMoltEvent = {
      type: 'unknown_event_type',
      payload: {},
    };

    const content = formatEventContent(event);

    expect(content).toContain('SpaceMolt event');
    expect(content).toContain('unknown_event_type');
  });

  test('returns non-empty string for all event types', () => {
    const eventTypes = [
      'combat_update',
      'player_died',
      'chat_message',
      'trade_offer_received',
      'mining_yield',
      'scan_detected',
      'skill_level_up',
      'tick',
      'welcome',
      'logged_in',
      'random_event',
    ];

    for (const eventType of eventTypes) {
      const event: SpaceMoltEvent = {
        type: eventType,
        payload: {
          attacker: 'X',
          target: 'Y',
          damage: 10,
          damage_type: 'kinetic',
          killer_name: 'Z',
          respawn_base: 'B',
          channel: 'c',
          sender: 's',
          content: 'msg',
          offerer_name: 'o',
          offer_credits: 100,
          quantity: 50,
          resource_name: 'res',
          remaining: 1000,
          scanner_username: 'u',
          skill_id: 'sk',
          new_level: 3,
        },
      };

      const formatted = formatEventContent(event);
      expect(formatted.length).toBeGreaterThan(0);
    }
  });
});
