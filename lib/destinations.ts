/**
 * The one list of destinations the workspace has.
 *
 * The rail, the phone bar, the More dialog and the command palette all navigate
 * to the same nine places, and each of them used to be free to hold its own copy
 * of the list. A destination added to the rail but not to the palette is a
 * destination the palette cannot find, which reads as the palette being broken;
 * a destination removed from one and left in the other is a button that goes
 * nowhere. Neither failure announces itself, so there is one list.
 *
 * `primary` is the four that earn a place on a phone. `secondary` is everything
 * else, which the rail shows in full and the phone bar hides behind More. The
 * split is about width, not importance.
 */

export type DestinationGroup = 'primary' | 'secondary';

export type WorkspaceDestination = {
  id: string;
  label: string;
  /** The workspace heading that surface shows, which is also what a palette row searches. */
  heading: string;
  glyph: string;
  group: DestinationGroup;
};

export type Translate = (en: string, zh: string) => string;

/** Every destination, primary first, in the order the rail lists them. */
export function workspaceDestinations(t: Translate): WorkspaceDestination[] {
  return [
    { id: 'plan', label: t('Plan', '規劃'), heading: t('Plan your next connection', '規劃你嘅下一程'), glyph: 'alt_route', group: 'primary' },
    { id: 'status', label: t('Live', '即時'), heading: t('The network, right now', '交通網絡現況'), glyph: 'sensors', group: 'primary' },
    { id: 'vehicles', label: t('Vehicles', '車輛'), heading: t('Find your next ride', '搵你嘅下一程車'), glyph: 'directions_bus', group: 'primary' },
    { id: 'saved', label: t('Saved', '已儲存'), heading: t('Ready when you are', '隨時準備出發'), glyph: 'bookmark', group: 'primary' },
    { id: 'race', label: t('Race', '比賽'), heading: t('Race across the region', '同人鬥快跨區'), glyph: 'flag', group: 'secondary' },
    { id: 'divisions', label: t('Out of division', '跨車廠'), heading: t('Beyond the usual garage', '跨越平日車廠分配'), glyph: 'garage', group: 'secondary' },
    { id: 'history', label: t('History', '歷史'), heading: t('The service record', '服務歷史記錄'), glyph: 'history', group: 'secondary' },
    { id: 'coverage', label: t('Our region', '服務範圍'), heading: t('Across the whole region', '接通整個地區'), glyph: 'public', group: 'secondary' },
    { id: 'settings', label: t('Settings', '設定'), heading: t('Make yourself at home', '按你喜好設定'), glyph: 'settings', group: 'secondary' },
  ];
}

/** The four the phone bar shows. */
export function primaryDestinations(t: Translate): WorkspaceDestination[] {
  return workspaceDestinations(t).filter((destination) => destination.group === 'primary');
}

/** Everything the phone bar hides behind More, which the rail still lists. */
export function secondaryDestinations(t: Translate): WorkspaceDestination[] {
  return workspaceDestinations(t).filter((destination) => destination.group === 'secondary');
}

/** The heading for a destination, or an empty string when the id is not one of ours. */
export function destinationHeading(t: Translate, id: string): string {
  return workspaceDestinations(t).find((destination) => destination.id === id)?.heading ?? '';
}
