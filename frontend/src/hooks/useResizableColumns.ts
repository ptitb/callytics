import { useCallback, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export type ColumnWidths<Key extends string> = Record<Key, number>;

const MIN_COLUMN_WIDTH = 48;

function readStoredWidths<Key extends string>(storageKey: string, defaults: ColumnWidths<Key>): ColumnWidths<Key> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaults;
    const stored = JSON.parse(raw) as Partial<Record<Key, unknown>>;
    const merged = { ...defaults };
    for (const key of Object.keys(defaults) as Key[]) {
      const value = stored[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= MIN_COLUMN_WIDTH) {
        merged[key] = value;
      }
    }
    return merged;
  } catch {
    return defaults;
  }
}

function storeWidths<Key extends string>(storageKey: string, widths: ColumnWidths<Key>): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(widths));
  } catch {
    // Storage can be unavailable (private mode); widths then reset on reload.
  }
}

/**
 * Column widths in pixels that the user can change by dragging a handle in the
 * header. Widths are remembered per browser under storageKey.
 */
export function useResizableColumns<Key extends string>(storageKey: string, defaults: ColumnWidths<Key>) {
  const [widths, setWidths] = useState<ColumnWidths<Key>>(() => readStoredWidths(storageKey, defaults));

  const startResize = useCallback(
    (key: Key, event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = widths[key];
      let latest = widths;

      const onMove = (moveEvent: PointerEvent) => {
        const width = Math.max(MIN_COLUMN_WIDTH, Math.round(startWidth + moveEvent.clientX - startX));
        latest = { ...latest, [key]: width };
        setWidths(latest);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
        storeWidths(storageKey, latest);
      };

      document.body.style.cursor = 'col-resize';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [storageKey, widths],
  );

  const resetWidths = useCallback(() => {
    setWidths(defaults);
    storeWidths(storageKey, defaults);
  }, [defaults, storageKey]);

  return { widths, startResize, resetWidths };
}
