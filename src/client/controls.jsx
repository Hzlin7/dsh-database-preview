/**
 * Controls for the database preview, aligned with the DSH Settings pages.
 *
 * Two sources, resolved here so no component in this plugin hand-rolls a control
 * that already exists:
 *
 * - `@deepseek-ai/dsh-client-ui-primitives` is part of the web shell's static
 *   module table, so a plugin bundle may require it directly. Every button, text
 *   field, checkbox, switch and tag below renders through it.
 * - A dropdown's popup is the shared `Menu`, which is how the Settings pages
 *   build theirs: the Language row in Settings → General is exactly
 *   `items` of `{ id, label }` plus a `selectedId` and a `portal` list. A native
 *   `<select>` cannot match, because the platform draws its open list and no
 *   stylesheet reaches it; the native select survives here only as the
 *   degradation path for a shell without the primitives.
 *
 * A shell that does not seed the primitives still renders: each wrapper falls
 * back to a plain element carrying the same class the stylesheet defines.
 * @module dsh-database-preview/client/controls
 */
import React from 'react'
import { PREFIX } from './styles.js'

/**
 * The module loader's own `require`.
 *
 * The access is indirect on purpose. A static `import` of a kernel module would
 * be hoisted and throw at module init — before the guard below could fall back —
 * and a direct `require('…')` call would send the bundler looking for a package
 * that only exists inside the browser kernel.
 */
const loaderRequire = typeof require === 'function' ? require : undefined

/**
 * Whether a value can be rendered as a component.
 *
 * A `typeof value === 'function'` test is not enough. `forwardRef` and `memo`
 * return an **object** carrying a `$$typeof` symbol, and the shared package
 * builds both `Button` and `Input` with `forwardRef` — so a function-only check
 * silently reported them missing and demoted those two controls to the fallback,
 * while `Menu`, `Tag` and the icons (plain functions) kept working. That is a
 * whole-panel style regression with no error anywhere, which is why the check
 * lives here once instead of at each call site.
 * @param value - a candidate component.
 * @returns whether React can render it as an element type.
 */
function isComponent(value) {
  if (typeof value === 'function') return true
  if (typeof value !== 'object' || value === null) return false
  return typeof value.$$typeof === 'symbol'
}

/** The kernel's shared primitives, when this shell provides them. */
let shared
try {
  shared = loaderRequire === undefined ? undefined : loaderRequire('@deepseek-ai/dsh-client-ui-primitives')
} catch {
  shared = undefined
}

/**
 * One of the primitive package's icons, or undefined when it is absent.
 * @param name - exported icon name, for example `IconRefreshOutlineRegular`.
 * @returns the icon component, or undefined.
 */
export function icon(name) {
  const found = shared?.[name]
  return isComponent(found) ? found : undefined
}

/** Join class names, dropping the empty ones. */
function cls(...names) {
  return names.filter((name) => typeof name === 'string' && name !== '').join(' ')
}

/**
 * An action button: the shared `Button` in every shell that has it, otherwise a
 * native button carrying the same variant's class.
 * @param root0 - component props.
 * @param root0.variant - `primary`, `ghost`, `outline` or `toolbar`.
 * @param root0.size - `md` (36px) or `sm` (28px).
 * @param root0.icon - leading icon node.
 */
export function AppButton({ variant = 'ghost', size = 'md', icon: leading, className, danger = false, children, ...rest }) {
  const SharedButton = shared?.Button
  if (isComponent(SharedButton)) {
    return (
      <SharedButton variant={variant} size={size} icon={leading} className={cls(className, danger ? `${PREFIX}-danger` : '')} {...rest}>
        {children}
      </SharedButton>
    )
  }
  return (
    <button
      type="button"
      className={cls(
        `${PREFIX}-button`,
        variant === 'primary' ? `${PREFIX}-buttonPrimary` : '',
        variant === 'outline' ? `${PREFIX}-buttonOutline` : '',
        size === 'sm' ? `${PREFIX}-buttonSm` : '',
        danger ? `${PREFIX}-danger` : '',
        className,
      )}
      {...rest}
    >
      {leading !== undefined && leading !== null ? <span className={`${PREFIX}-buttonIcon`}>{leading}</span> : null}
      {children}
    </button>
  )
}

/**
 * A single-line text field: the shared `Input` when present. Native input
 * attributes pass through unchanged.
 */
export function AppInput({ icon: leading, className, ...rest }) {
  const SharedInput = shared?.Input
  if (isComponent(SharedInput)) return <SharedInput icon={leading} className={className} {...rest} />
  return <input className={cls(`${PREFIX}-input`, className)} {...rest} />
}

/** A labelled checkbox; `onChange` receives the new boolean, as the primitive does. */
export function AppCheckbox({ checked, onChange, label, disabled = false, title, className }) {
  const SharedCheckbox = shared?.Checkbox
  if (isComponent(SharedCheckbox)) {
    return <SharedCheckbox checked={checked} onChange={onChange} label={label} disabled={disabled} title={title} className={className} />
  }
  return (
    <label className={cls(`${PREFIX}-checkbox`, className)} title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

/** A read-only capsule badge. */
export function AppTag({ tone = 'outline', className, children }) {
  const SharedTag = shared?.Tag
  if (isComponent(SharedTag)) {
    return (
      <SharedTag tone={tone} className={className}>
        {children}
      </SharedTag>
    )
  }
  return <span className={cls(`${PREFIX}-fieldLabel`, className)}>{children}</span>
}

/**
 * A dropdown.
 *
 * The popup is the shared `Menu`: no stylesheet reaches a native `<select>`'s
 * open list, because the platform draws it, and that is the one part of a
 * dropdown that cannot be made to match. The Settings pages build their
 * dropdowns the same way — the Language row in Settings → General is exactly
 * this shape: `items` of `{ id, label }`, a `selectedId`, and a `portal` list
 * rendered from the trigger's rect.
 *
 * Without the primitives the control degrades to a native `<select>`, which is
 * the treatment the Settings model form gives its own selects. The panel keeps
 * working, and a long table list keeps its type-ahead there.
 *
 * @param root0 - component props.
 * @param root0.options - `[{ value, label, disabled? }]`.
 * @param root0.label - accessible name; the visible label belongs to the caller's `Field`.
 * @param root0.align - which edge of the trigger the list aligns to.
 */
export function Dropdown({ value, options, onChange, label, align = 'start', disabled = false, wrapClassName }) {
  const [open, setOpen] = React.useState(false)
  const MenuPrimitive = shared?.Menu

  if (!isComponent(MenuPrimitive)) {
    return (
      <select
        className={`${PREFIX}-select`}
        value={value ?? ''}
        aria-label={label}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled === true}>
            {option.label}
          </option>
        ))}
      </select>
    )
  }

  const Chevron = icon('IconChevronDownOutlineRegular') ?? icon('IconChevronDownOutlineMedium')
  const selected = options.find((option) => option.value === value)
  return (
    <MenuPrimitive
      open={open}
      onClose={() => setOpen(false)}
      items={options.map((option) => ({ id: option.value, label: option.label, disabled: option.disabled === true }))}
      selectedId={value}
      onSelect={(id) => {
        setOpen(false)
        onChange(id)
      }}
      align={align}
      portal
      className={cls(`${PREFIX}-dropdownWrap`, wrapClassName)}
      anchor={
        <button
          type="button"
          className={`${PREFIX}-dropdown`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          disabled={disabled}
          onClick={() => setOpen((previous) => !previous)}
        >
          <span className={`${PREFIX}-dropdownLabel`}>{selected === undefined ? '' : selected.label}</span>
          {Chevron === undefined ? null : <Chevron />}
        </button>
      }
    />
  )
}

/**
 * A labelled field: the 12px secondary label above its control, as Settings uses.
 * @param root0 - component props.
 * @param root0.label - the visible label.
 * @param root0.wide - whether the field takes a whole row.
 * @param root0.className - extra class, for a field's width inside a shared row.
 */
export function Field({ label, wide = false, className, children }) {
  return (
    <label className={cls(`${PREFIX}-field`, wide ? `${PREFIX}-fieldWide` : '', className)}>
      <span className={`${PREFIX}-fieldLabel`}>{label}</span>
      {children}
    </label>
  )
}

/** A small indeterminate progress mark. */
export function Spinner() {
  return <span className={`${PREFIX}-spinner`} aria-hidden="true" />
}
