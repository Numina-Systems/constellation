// pattern: Functional Core

import type {GameState} from './types.ts';
import type {ToolDefinition} from '../../tool/types.ts';

const ALWAYS_TOOLS: ReadonlyArray<string> = [
  'get_status',
  'get_ship',
  'get_cargo',
  'get_skills',
  'get_version',
  'chat',
  'get_chat_history',
  'help',
  'catalog',
  'analyze_market',
  'find_route',
  'search_systems',
  'get_map',
  'get_notifications',
  'get_commands',
  'get_guide',
  'get_notes',
  'create_note',
  'read_note',
  'write_note',
  'captains_log_add',
  'captains_log_list',
  'captains_log_get',
  'get_action_log',
  'forum_list',
  'forum_get_thread',
];

const DOCKED_TOOLS: ReadonlyArray<string> = [
  'buy',
  'sell',
  'undock',
  'repair',
  'refuel',
  'craft',
  'get_base',
  'view_market',
  'view_orders',
  'view_storage',
  'deposit_items',
  'withdraw_items',
  'send_gift',
  'browse_ships',
  'switch_ship',
  'list_ships',
  'buy_listed_ship',
  'sell_ship',
  'commission_ship',
  'install_mod',
  'uninstall_mod',
  'repair_module',
  'get_missions',
  'accept_mission',
  'complete_mission',
  'get_insurance_quote',
  'buy_insurance',
  'set_home_base',
  'create_buy_order',
  'create_sell_order',
  'modify_order',
  'cancel_order',
  'estimate_purchase',
  'refit_ship',
  'use_item',
  'name_ship',
  'get_trades',
  'trade_accept',
  'trade_decline',
  'trade_cancel',
  'facility',
];

const UNDOCKED_TOOLS: ReadonlyArray<string> = [
  'travel',
  'jump',
  'dock',
  'mine',
  'survey_system',
  'attack',
  'scan',
  'cloak',
  'reload',
  'get_poi',
  'get_system',
  'get_nearby',
  'get_wrecks',
  'trade_offer',
  'jettison',
  'refuel',
  'repair',
  'tow_wreck',
  'release_tow',
  'loot_wreck',
  'salvage_wreck',
  'scrap_wreck',
  'sell_wreck',
  'self_destruct',
  'battle',
  'get_battle_status',
  'fleet',
];

const COMBAT_TOOLS: ReadonlyArray<string> = [
  'attack',
  'scan',
  'cloak',
  'reload',
  'get_battle_status',
  'battle',
  'self_destruct',
  'get_nearby',
  'get_poi',
  'get_system',
  'refuel',
  'repair',
  'use_item',
];

const TRAVELING_TOOLS: ReadonlyArray<string> = [
  'get_system',
  'get_poi',
];

function getToolsForState(state: GameState): ReadonlyArray<string> {
  switch (state) {
    case 'DOCKED':
      return DOCKED_TOOLS;
    case 'UNDOCKED':
      return UNDOCKED_TOOLS;
    case 'COMBAT':
      return COMBAT_TOOLS;
    case 'TRAVELING':
      return TRAVELING_TOOLS;
    default:
      const _exhaustive: never = state;
      return _exhaustive;
  }
}

function stripToolPrefix(toolName: string): string {
  if (toolName.startsWith('spacemolt:')) {
    return toolName.slice(10);
  }
  return toolName;
}

export function filterToolsByState(
  allTools: ReadonlyArray<ToolDefinition>,
  state: GameState,
): Array<ToolDefinition> {
  const stateSpecificTools = getToolsForState(state);
  const allowedTools = new Set([...ALWAYS_TOOLS, ...stateSpecificTools]);

  return allTools.filter(tool => {
    const baseToolName = stripToolPrefix(tool.name);
    return allowedTools.has(baseToolName);
  });
}
