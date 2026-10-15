// What the platform under the app does itself. On the desktop the framework draws and edits
// everything; the DOM renderer hands text to the browser (<input>, DOM selection).

let nativeText = false;

/**
 * True where the platform edits and selects text itself: text fields only submit (Return) and
 * stop the keys the platform edits with, and <Text selectable> leaves selection to it. Set
 * before the app is mounted (the DOM boot()).
 */
export const hasNativeText = () => nativeText;

export function setNativeText(on: boolean) {
  nativeText = on;
}
