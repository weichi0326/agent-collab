import type { AppView } from '../stores/uiStore';

export function masterDrawerClassName(
  _expanded: boolean,
  fullscreen: boolean,
  _fullscreenClosing = false,
): string {
  const displayClass = fullscreen
    ? 'master-agent-drawer--fullscreen'
    : 'master-agent-drawer--half';
  return `master-drawer master-agent-drawer--pearl ${displayClass}`;
}

export function masterDrawerContentClassName(
  expanded: boolean,
  fullscreen: boolean,
  fullscreenClosing = false,
): string {
  const contentOpen = shouldKeepDrawerContentOpen(expanded, fullscreenClosing);
  const classes = ['master-drawer__content'];

  if (contentOpen) {
    classes.push('master-drawer__content--open');
  }
  if (fullscreen && contentOpen) {
    classes.push('master-drawer__content--fullscreen');
  }
  if (fullscreenClosing) {
    classes.push('master-drawer__content--fullscreen-closing');
  } else if (fullscreen && !contentOpen) {
    classes.push('master-drawer__content--fullscreen-collapsed');
  }

  return classes.join(' ');
}

export function shouldKeepDrawerContentOpen(
  expanded: boolean,
  fullscreenClosing: boolean,
): boolean {
  return expanded || fullscreenClosing;
}

export function shouldScheduleDrawerUnmount({
  expanded,
  mounted,
  anySending,
  view,
}: {
  expanded: boolean;
  mounted: boolean;
  anySending: boolean;
  view: AppView;
}): boolean {
  return !expanded && mounted && !anySending && view === 'workspace';
}
