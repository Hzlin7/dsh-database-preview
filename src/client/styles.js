/**
 * Scoped stylesheet for the database preview.
 *
 * The design language is the one the Settings pages use: the same `--dsw-*`
 * alias tokens, a 32px field with a 12px secondary label, `settings-card-*`
 * cards, and `radius-*` corners. Buttons, text fields, checkboxes and switches
 * are the shared primitives (see `controls.jsx`), so the rules here only cover
 * layout and the controls that have no primitive — the native `<select>`, whose
 * treatment is copied from the Settings model form rather than invented.
 * @module dsh-database-preview/client/styles
 */

/** Extra class prefix, keeping every rule out of other packages' way. */
export const PREFIX = 'dbp'

/** The stylesheet text. */
export const STYLES = `
/* Everything below is inside a template literal. Never write a backtick or a
   dollar-brace in these comments: either one ends the string and the build (and
   the test import) fails with a syntax error pointing at the prose. */
.${PREFIX}-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.5;
}

/* ---------- rows and fields ---------- */
.${PREFIX}-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 12px 8px;
  border-bottom: .5px solid var(--dsw-alias-border-l3);
}
.${PREFIX}-bar:last-child { border-bottom: none; }
.${PREFIX}-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1 1 130px; }
.${PREFIX}-fieldWide { flex: 1 1 100%; }
/* One chrome row: every control keeps its content width so the group stays
   packed left, and the spacer at the end absorbs the slack. The table picker is
   the one field that needs room, so it may shrink but never grows. */
.${PREFIX}-fieldTable { flex: 0 1 200px; min-width: 110px; }
.${PREFIX}-fieldNarrow { flex: 0 0 auto; }
.${PREFIX}-fieldLabel {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
}
.${PREFIX}-spacer { flex: 1 1 auto; }
.${PREFIX}-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.${PREFIX}-muted { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }

/* ---------- the native select, in the Settings treatment ---------- */
.${PREFIX}-input,
.${PREFIX}-select {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  background: var(--dsw-alias-bg-layer-1);
  border: .5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
}
.${PREFIX}-input:focus,
.${PREFIX}-select:focus { border-color: var(--dsw-alias-state-business-primary); outline: none; }
.${PREFIX}-input::placeholder { color: var(--dsw-alias-label-dimmed); }
.${PREFIX}-input:disabled,
.${PREFIX}-select:disabled { opacity: .6; cursor: default; }
.${PREFIX}-select {
  appearance: none;
  cursor: pointer;
  padding-right: 32px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-position: right 12px center;
  background-repeat: no-repeat;
  background-size: 12px 12px;
}

/* ---------- the dropdown trigger, in the Settings selector treatment ----------
   Copied from the Language row's selector in Settings: a filled pill, not a
   bordered field. The open list is the shared Menu primitive, which owns its
   own styling; only this trigger belongs to the feature. */
.${PREFIX}-dropdownWrap { display: flex; flex: 0 0 auto; min-width: 0; }
.${PREFIX}-dropdownWrapNarrow { width: 92px; }
.${PREFIX}-dropdown {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-width: 0;
  height: 36px;
  padding: 0 14px;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  background: var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-1));
  border: none;
  border-radius: var(--dsw-radius-md);
  cursor: pointer;
}
.${PREFIX}-dropdown:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.${PREFIX}-dropdown:disabled { opacity: .6; cursor: default; }
.${PREFIX}-dropdown:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.${PREFIX}-dropdownLabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* An action that shares the dropdown trigger's surface: same fill, same hover,
   no border. It is deliberately the dropdown's own background token rather than
   the shared Button's toolbar variant — that variant fills with
   --dsw-alias-button-tool-bar-fill, a different colour, and would sit next to the
   trigger as a visible mismatch. */
.${PREFIX}-chip { background: var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-1)); }
/* The class is doubled on purpose: the shared Button's own hover rule is
   .ghost:hover:not(:disabled), so a single-class override would lose the hover
   state to it. */
.${PREFIX}-chip.${PREFIX}-chip:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
/* A glyph-only action: square at the row's 36px and stripped of the horizontal
   padding the shared Button reserves for a label, so the 16px icon slot is what
   centres. Without this the padding would leave an off-centre glyph. */
.${PREFIX}-iconButton { width: 36px; padding: 0; }

/* ---------- fallbacks for a host without the shared primitives ---------- */
.${PREFIX}-button {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 36px;
  padding: 0 14px;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  background: transparent;
  border: none;
  border-radius: var(--dsw-radius-md);
  cursor: pointer;
}
/* The fallback mirrors the shared Button's metrics so the panel does not change
   shape when the primitives are missing: same heights, corners and paddings. */
.${PREFIX}-buttonSm {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  line-height: 18px;
  border-radius: var(--dsw-radius-sm);
}
.${PREFIX}-buttonOutline { border: .5px solid var(--dsw-alias-border-l3); }
/* The 16px icon slot the shared Button gives its leading icon; without it the
   inline SVG sits on the text baseline and reads as vertically off-centre. */
.${PREFIX}-buttonIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}
.${PREFIX}-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.${PREFIX}-button:disabled { opacity: .4; cursor: default; }
.${PREFIX}-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.${PREFIX}-buttonPrimary {
  color: var(--dsw-alias-label-primary-foreground);
  background: var(--dsw-alias-button-primary-fill);
  border-color: transparent;
}
.${PREFIX}-buttonPrimary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.${PREFIX}-checkbox { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.${PREFIX}-checkbox input { margin: 0; }

/* A deliberate difference on top of a shared control, kept to one class. */
.${PREFIX}-danger { color: var(--dsw-alias-state-error-primary); }
.${PREFIX}-danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }

/* ---------- scrolling surfaces ---------- */
.${PREFIX}-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; }
.${PREFIX}-notice {
  margin: 12px;
  padding: 10px 12px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  background: var(--dsw-alias-settings-card-fill);
  border: .5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-lg);
}
.${PREFIX}-noticeError { color: var(--dsw-alias-state-error-primary); }

/* ---------- the data grid ---------- */
.${PREFIX}-grid { width: 100%; border-collapse: separate; border-spacing: 0; font-variant-numeric: tabular-nums; }
.${PREFIX}-grid th,
.${PREFIX}-grid td {
  max-width: 420px;
  padding: 5px 10px;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: .5px solid var(--dsw-alias-border-l3);
}
.${PREFIX}-grid thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  background: var(--dsw-alias-bg-layer-1);
}
.${PREFIX}-num { text-align: right; }
.${PREFIX}-pk { margin-left: 4px; color: var(--dsw-alias-label-tertiary); font-size: 10px; }
.${PREFIX}-null { color: var(--dsw-alias-label-tertiary); font-style: italic; }
.${PREFIX}-blob { color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

/* ---------- column resizing ----------
   A grip rides the right edge of every header cell of the data view. The header
   is sticky, so it is already a containing block for an absolutely positioned
   child, and its own overflow cannot clip the grip: the grip sits inside the
   padding box. The header keeps a little more right padding than the body cells
   so the text never runs under the grip. The selector carries the grid class
   because the cell rule above is more specific than a bare class would be. */
.${PREFIX}-grid .${PREFIX}-th { padding-right: 16px; }
.${PREFIX}-grip {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 8px;
  cursor: col-resize;
  touch-action: none;
}
/* The bar appears on hover and for as long as its own drag lasts — a target that
   is invisible until it is needed, but not invisible while in use. */
.${PREFIX}-grip::before {
  content: '';
  position: absolute;
  top: 3px;
  right: 2px;
  bottom: 3px;
  width: 2px;
  border-radius: 1px;
  background: var(--dsw-alias-state-business-primary);
  opacity: 0;
  transition: opacity .12s ease;
}
.${PREFIX}-grip:hover::before,
.${PREFIX}-gripActive::before { opacity: 1; }
.${PREFIX}-grip:focus-visible {
  outline: none;
  box-shadow: inset -2px 0 0 var(--dsw-alias-state-business-primary);
}
/* While a drag is in flight the column cursor holds everywhere and the rows stop
   selecting text, so a drag that wanders off the grip cannot paint a selection. */
.${PREFIX}-resizing { cursor: col-resize; user-select: none; }
/* A grid laid out from declared widths is bounded by them, so the content cap
   that keeps an auto-laid-out table from growing without bound no longer
   applies — and it would clamp a deliberate drag. */
.${PREFIX}-gridSized th,
.${PREFIX}-gridSized td { max-width: none; }

/* ---------- the connection list ---------- */
.${PREFIX}-list { display: flex; flex-direction: column; gap: 8px; padding: 12px; }
.${PREFIX}-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 14px;
  background: var(--dsw-alias-settings-card-fill);
  border: .5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-xl);
}
.${PREFIX}-cardHead { display: flex; align-items: center; gap: 10px; }
.${PREFIX}-cardName { color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; line-height: 22px; }
.${PREFIX}-cardActions { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; }
.${PREFIX}-form { display: flex; flex-wrap: wrap; gap: 12px; padding: 12px; }

/* ---------- the structure view ---------- */
.${PREFIX}-sectionTitle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 4px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
}
.${PREFIX}-structure { padding: 0 12px 12px; }
.${PREFIX}-spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  vertical-align: -1px;
  border: 1.5px solid var(--dsw-alias-border-l3);
  border-top-color: transparent;
  border-radius: 50%;
  animation: ${PREFIX}-spin .8s linear infinite;
}
@keyframes ${PREFIX}-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .${PREFIX}-spinner { animation-duration: 3s; } }
`

/**
 * Insert the stylesheet once and return its disposer.
 * @returns a function that removes the injected element.
 */
export function installStyles() {
  const element = document.createElement('style')
  element.setAttribute('data-plugin', 'dsh-database-preview')
  element.textContent = STYLES
  document.head.appendChild(element)
  return () => {
    element.remove()
  }
}
