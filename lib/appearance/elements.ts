import type { UiState } from './document.ts';

export type AppearanceElement = {
  id: string;
  label: { en: string; zh: string };
  surface: string;
  inherits?: string;
  states: readonly UiState[];
};

const allStates = ['normal', 'hover', 'focus', 'pressed', 'selected', 'disabled', 'error'] as const satisfies readonly UiState[];
const interactive = ['normal', 'hover', 'focus', 'pressed', 'disabled', 'error'] as const satisfies readonly UiState[];

/**
 * This is deliberately a hand-written registry, rather than a selector or DOM
 * discovery list. The editor can only address identifiers that product JSX has
 * explicitly opted into, which prevents an imported document styling arbitrary
 * browser chrome or a future, unreviewed control.
 */
export const UI_ELEMENTS: readonly AppearanceElement[] = Object.freeze([
  { id: 'shell', label: { en: 'Planner shell', zh: '規劃器外框' }, surface: 'workspace', states: allStates },
  { id: 'brand.mark', label: { en: 'Brand mark', zh: '品牌標記' }, surface: 'navigation', inherits: 'shell', states: allStates },
  { id: 'brand.name', label: { en: 'Application name', zh: '應用程式名稱' }, surface: 'navigation', inherits: 'brand.mark', states: allStates },
  { id: 'navigation.rail', label: { en: 'Navigation rail', zh: '導覽列' }, surface: 'navigation', inherits: 'shell', states: allStates },
  { id: 'navigation.destination', label: { en: 'Destination', zh: '目的地' }, surface: 'navigation', inherits: 'navigation.rail', states: interactive },
  { id: 'settings.workspace', label: { en: 'Settings workspace', zh: '設定工作區' }, surface: 'settings', inherits: 'shell', states: allStates },
  { id: 'settings.card', label: { en: 'Settings card', zh: '設定卡' }, surface: 'settings', inherits: 'settings.workspace', states: allStates },
  { id: 'settings.field', label: { en: 'Settings field', zh: '設定欄位' }, surface: 'settings', inherits: 'settings.card', states: interactive },
  { id: 'settings.action', label: { en: 'Settings action', zh: '設定動作' }, surface: 'settings', inherits: 'settings.card', states: interactive },
  { id: 'command.palette', label: { en: 'Command palette', zh: '指令選單' }, surface: 'palette', inherits: 'shell', states: allStates },
  { id: 'command.palette.field', label: { en: 'Command palette search', zh: '指令選單搜尋' }, surface: 'palette', inherits: 'command.palette', states: interactive },
  { id: 'command.palette.option', label: { en: 'Command palette option', zh: '指令選單選項' }, surface: 'palette', inherits: 'command.palette', states: interactive },
  { id: 'journey.list', label: { en: 'Journey list', zh: '行程列表' }, surface: 'plan', inherits: 'shell', states: allStates },
  { id: 'journey.option.card', label: { en: 'Journey option card', zh: '行程選項卡' }, surface: 'plan', inherits: 'journey.list', states: allStates },
  { id: 'journey.option.action', label: { en: 'Journey option action', zh: '行程選項動作' }, surface: 'plan', inherits: 'journey.option.card', states: interactive },
  { id: 'status.card', label: { en: 'Status card', zh: '狀態卡' }, surface: 'status', inherits: 'shell', states: allStates },
  { id: 'saved.row', label: { en: 'Saved trip row', zh: '已儲存行程列' }, surface: 'saved', inherits: 'shell', states: allStates },
  { id: 'tracker.row', label: { en: 'Vehicle tracker row', zh: '車輛追蹤列' }, surface: 'tracker', inherits: 'shell', states: allStates },
  { id: 'notification.centre', label: { en: 'Notification centre', zh: '通知中心' }, surface: 'notifications', inherits: 'shell', states: allStates },
  { id: 'notification.toast', label: { en: 'Notification toast', zh: '通知提示' }, surface: 'notifications', inherits: 'notification.centre', states: allStates },
  { id: 'dialog', label: { en: 'Dialog', zh: '對話框' }, surface: 'overlay', inherits: 'shell', states: allStates },
  { id: 'dialog.action', label: { en: 'Dialog action', zh: '對話框動作' }, surface: 'overlay', inherits: 'dialog', states: interactive },
  { id: 'search.workbench', label: { en: 'Search workbench', zh: '搜尋工作台' }, surface: 'search', inherits: 'shell', states: allStates },
  { id: 'search.workbench.field', label: { en: 'Search field', zh: '搜尋欄位' }, surface: 'search', inherits: 'search.workbench', states: interactive },
  { id: 'appearance.editor.panel', label: { en: 'Appearance editor', zh: '外觀編輯器' }, surface: 'appearance', inherits: 'shell', states: allStates },
  { id: 'appearance.context.menu', label: { en: 'Appearance context menu', zh: '外觀右鍵選單' }, surface: 'appearance', inherits: 'shell', states: allStates },
  { id: 'appearance.listbox', label: { en: 'Appearance listbox', zh: '外觀選項列表' }, surface: 'appearance', inherits: 'appearance.editor.panel', states: interactive },
]);

const elementMap = new Map(UI_ELEMENTS.map((element) => [element.id, element]));

const destinations = ['plan', 'status', 'vehicles', 'saved', 'race', 'divisions', 'history', 'coverage', 'settings'];
const settings = ['appearance', 'language', 'comfort', 'narrator', 'privacy'];
for (const [surface, ids] of [['navigation', destinations], ['settings', settings]] as const) {
  for (const id of ids) elementMap.set(`tab:${surface}:${id}`, { id: `tab:${surface}:${id}`, label: { en: `${surface}: ${id}`, zh: `${surface}: ${id}` }, surface, inherits: 'navigation.destination', states: allStates });
}

export function appearanceElement(id: string): AppearanceElement | null {
  if (/^tab-group:(navigation|settings):group-[a-z0-9]{1,48}$/.test(id)) return { id, label: { en: 'Tab group', zh: '分頁群組' }, surface: 'navigation', inherits: 'navigation.rail', states: allStates };
  return elementMap.get(id) ?? null;
}

export function canInheritFrom(id: string, candidate: string): boolean {
  if (id === candidate) return false;
  const seen = new Set<string>();
  let current = appearanceElement(id);
  while (current?.inherits && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.inherits === candidate) return true;
    current = appearanceElement(current.inherits);
  }
  return false;
}
