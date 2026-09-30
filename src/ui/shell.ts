/** True in the live prototype (index.html marks <html data-ds="desktop"> before first
 *  paint): both themes run the desktop design system (src/styles/desktop.css) and the
 *  sidebar shell. The decks, demo and video load tour.html, which keeps the original
 *  shell, so their walkthroughs and recordings are unaffected. */
export const DESKTOP_SHELL =
  typeof document !== "undefined" && document.documentElement.dataset.ds === "desktop";
