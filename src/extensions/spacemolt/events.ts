// pattern: Functional Core

import type {SpaceMoltEvent} from './types';

export type EventTier = 'high' | 'normal' | 'internal';

const HIGH_PRIORITY_EVENTS = new Set<string>([
  'combat_update',
  'player_died',
  'trade_offer_received',
  'scan_detected',
  'pilotless_ship',
]);

const INTERNAL_EVENTS = new Set<string>(['tick', 'welcome', 'logged_in']);

export function classifyEvent(eventType: string): EventTier {
  if (HIGH_PRIORITY_EVENTS.has(eventType)) {
    return 'high';
  }
  if (INTERNAL_EVENTS.has(eventType)) {
    return 'internal';
  }
  return 'normal';
}

export function isHighPriority(eventType: string): boolean {
  return classifyEvent(eventType) === 'high';
}

export function formatEventContent(event: Readonly<SpaceMoltEvent>): string {
  const {type, payload} = event;

  switch (type) {
    case 'combat_update': {
      const attacker = String(payload['attacker'] ?? 'Unknown');
      const target = String(payload['target'] ?? 'Unknown');
      const damage = String(payload['damage'] ?? '?');
      const damageType = String(payload['damage_type'] ?? 'unknown');
      return `Combat: ${attacker} attacked ${target} for ${damage} damage (${damageType})`;
    }

    case 'player_died': {
      const killerName = String(payload['killer_name'] ?? 'Unknown');
      const respawnBase = String(payload['respawn_base'] ?? 'Unknown base');
      return `Death: Killed by ${killerName}. Respawning at ${respawnBase}.`;
    }

    case 'chat_message': {
      const channel = String(payload['channel'] ?? 'general');
      const sender = String(payload['sender'] ?? 'Unknown');
      const content = String(payload['content'] ?? '');
      return `Chat [${channel}] ${sender}: ${content}`;
    }

    case 'trade_offer_received': {
      const offererName = String(payload['offerer_name'] ?? 'Unknown');
      const offerCredits = String(payload['offer_credits'] ?? '0');
      return `Trade offer from ${offererName}: offering ${offerCredits} credits`;
    }

    case 'mining_yield': {
      const quantity = String(payload['quantity'] ?? '0');
      const resourceName = String(payload['resource_name'] ?? 'unknown');
      const remaining = String(payload['remaining'] ?? '0');
      return `Mined ${quantity} ${resourceName} (${remaining} remaining)`;
    }

    case 'scan_detected': {
      const scannerUsername = String(payload['scanner_username'] ?? 'Unknown');
      return `Scan detected: ${scannerUsername} scanned you`;
    }

    case 'skill_level_up': {
      const skillId = String(payload['skill_id'] ?? 'unknown');
      const newLevel = String(payload['new_level'] ?? '0');
      return `Skill up: ${skillId} reached level ${newLevel}`;
    }

    default:
      return `SpaceMolt event: ${type}`;
  }
}
