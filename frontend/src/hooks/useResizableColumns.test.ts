import { act, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useResizableColumns } from './useResizableColumns';

const STORAGE_KEY = 'test.columnWidths';
const DEFAULTS = { first: 100, second: 200 };

function pointerDownAt(clientX: number): ReactPointerEvent<HTMLElement> {
  return { clientX, preventDefault: () => {}, stopPropagation: () => {} } as unknown as ReactPointerEvent<HTMLElement>;
}

// jsdom has no PointerEvent constructor; a MouseEvent with the pointer event type carries clientX.
function movePointerTo(clientX: number) {
  window.dispatchEvent(new MouseEvent('pointermove', { clientX }));
}

function releasePointer() {
  window.dispatchEvent(new MouseEvent('pointerup'));
}

describe('useResizableColumns', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('starts with the defaults', () => {
    const { result } = renderHook(() => useResizableColumns(STORAGE_KEY, DEFAULTS));
    expect(result.current.widths).toEqual(DEFAULTS);
  });

  it('resizes a column by dragging and remembers the width', () => {
    const { result } = renderHook(() => useResizableColumns(STORAGE_KEY, DEFAULTS));

    act(() => result.current.startResize('first', pointerDownAt(500)));
    act(() => movePointerTo(560));
    act(() => releasePointer());

    expect(result.current.widths.first).toBe(160);
    expect(result.current.widths.second).toBe(200);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({ first: 160, second: 200 });

    const { result: reloaded } = renderHook(() => useResizableColumns(STORAGE_KEY, DEFAULTS));
    expect(reloaded.current.widths.first).toBe(160);
  });

  it('does not shrink a column below the minimum width', () => {
    const { result } = renderHook(() => useResizableColumns(STORAGE_KEY, DEFAULTS));

    act(() => result.current.startResize('first', pointerDownAt(500)));
    act(() => movePointerTo(0));
    act(() => releasePointer());

    expect(result.current.widths.first).toBe(48);
  });

  it('ignores invalid stored values and can reset to the defaults', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ first: 'wide', second: 300 }));
    const { result } = renderHook(() => useResizableColumns(STORAGE_KEY, DEFAULTS));
    expect(result.current.widths).toEqual({ first: 100, second: 300 });

    act(() => result.current.resetWidths());
    expect(result.current.widths).toEqual(DEFAULTS);
  });
});
