export function masterDrawerClassName(
  expanded: boolean,
  fullscreen: boolean,
): string {
  return expanded && fullscreen
    ? 'master-drawer master-drawer--fullscreen'
    : 'master-drawer';
}
