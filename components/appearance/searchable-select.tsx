'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import AnchoredPopover from './anchored-popover.tsx';
import { SearchWorkbench, emptySearchState, useSearchMatches, type SearchState } from '../search-workbench.tsx';
import { menuKeyboard } from '../../lib/appearance/context-menu.ts';

export type Translate = (en: string, zh: string) => string;

export type SearchableSelectOption = { value: string; label: string; description?: string };

export type SearchableSelectProps = {
  id: string;
  label: string;
  value: string;
  options: readonly SearchableSelectOption[];
  onChange: (value: string) => void;
  storageId: string;
  t: Translate;
  disabled?: boolean;
  disabledReason?: string;
};

/**
 * A searchable dropdown, used everywhere this project would otherwise reach
 * for a long, unsearchable `<select>` -- the colour format picker, the named-
 * colour lookup, and any long choice list a future settings row needs.
 *
 * Typing in the head field is this control's typeahead: it filters the option
 * list live through the project's own regex-capable search, which is a strict
 * superset of the letter-by-letter jump a native `<select>` offers, so there is
 * no second, competing single-character jump here -- the two would fight over
 * the same keystrokes.
 *
 * `aria-activedescendant` needs to live on whichever element currently holds
 * focus, and the search field's own `<input>` is `components/search-
 * workbench.tsx`'s sealed internals -- this project's other components do not
 * reach inside it to add attributes. So focus starts there for typing, and the
 * first arrow key press hands focus to the option list itself, which is a
 * `role="listbox"` and carries `aria-activedescendant` from that point on. Both
 * halves are legal, commonly used listbox patterns; this is just the two of
 * them handed off at the moment arrow navigation actually starts.
 */
export default function SearchableSelect({ id, label, value, options, onChange, storageId, t, disabled, disabledReason }: SearchableSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState<SearchState>(emptySearchState);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = `${id}-listbox`;

  const samples = useMemo(() => options.map((option) => [option.label, option.description].filter(Boolean).join(' ')), [options]);
  const result = useSearchMatches(samples, search);
  const query = (search.mode === 'regex' ? search.pattern : search.query).trim();
  const visible = useMemo(
    () => (query.length === 0 ? [...options] : options.filter((_, index) => result.matches[index])),
    [options, query, result.matches],
  );

  useEffect(() => {
    if (!open) return;
    setSearch(emptySearchState());
    const frame = window.requestAnimationFrame(() => {
      surfaceRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  /** A new query re-aims at the current value if it is still visible, otherwise the first match. */
  useEffect(() => {
    const selectedIndex = visible.findIndex((option) => option.value === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : visible.length ? 0 : -1);
  }, [query, visible, value]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const commit = (option: SearchableSelectOption) => {
    onChange(option.value);
    close();
  };

  if (disabled) {
    return (
      <div className="appearance-select appearance-select--disabled">
        <span className="appearance-select__label">{label}</span>
        <button type="button" className="appearance-select__trigger" disabled>
          <span>{options.find((option) => option.value === value)?.label ?? value}</span>
          <ChevronDown size={18} aria-hidden="true" />
        </button>
        {disabledReason && <p className="appearance-select__reason">{disabledReason}</p>}
      </div>
    );
  }

  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    }
  };

  /** The first arrow key moves focus from the search field into the listbox itself. */
  const onSurfaceKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (document.activeElement === listRef.current) return;
    event.preventDefault();
    listRef.current?.focus();
    setActiveIndex((current) => menuKeyboard(current, visible.length, event.key));
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActiveIndex((current) => menuKeyboard(current, visible.length, event.key));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const option = visible[activeIndex];
      if (!option) return;
      event.preventDefault();
      commit(option);
    }
  };

  return (
    <div className="appearance-select" data-ui="appearance.select">
      <span className="appearance-select__label" id={`${id}-label`}>{label}</span>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className="appearance-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-labelledby={`${id}-label ${id}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
      >
        <span>{selectedLabel}</span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>

      <AnchoredPopover id={`${id}-popover`} anchor={triggerRef} open={open} onClose={close} label={label} preferred="bottom" t={t}>
        <div className="appearance-select__surface" ref={surfaceRef} onKeyDown={onSurfaceKeyDown}>
          <SearchWorkbench storageId={storageId} label={t('Filter options', '篩選選項')} value={search} onChange={setSearch} samples={samples} t={t} />
          <ul
            role="listbox"
            id={listboxId}
            aria-label={label}
            tabIndex={-1}
            ref={listRef}
            className="appearance-select__list"
            aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
            onKeyDown={onListKeyDown}
          >
            {visible.length === 0 && <li className="appearance-select__empty" role="presentation">{t('No matching options', '冇符合嘅選項')}</li>}
            {visible.map((option, index) => (
              <li
                key={option.value}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={option.value === value}
                data-active={index === activeIndex || undefined}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(option)}
              >
                <span className="appearance-select__option-label">{option.label}</span>
                {option.description && <small>{option.description}</small>}
              </li>
            ))}
          </ul>
        </div>
      </AnchoredPopover>
    </div>
  );
}
