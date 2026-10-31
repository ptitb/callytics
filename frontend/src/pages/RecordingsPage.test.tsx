import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { RecordingsPage } from './RecordingsPage';

import * as api from '../lib/api';
import { renderWithRouter } from '../test/renderWithRouter';

vi.mock('../lib/api', () => ({
  listRecordings: vi.fn(),
  listFlows: vi.fn(),
  deleteRecording: vi.fn(),
}));

describe('RecordingsPage coverage boost', () => {
  const mockRecordings = {
    data: [
      { id: 1, callId: 'call-1', fileName: 'rec1.wav', durationSeconds: 60, createdAt: new Date().toISOString(), remoteNumber: '+31612345678', operatorLabel: '101' },
      { id: 2, callId: 'call-2', fileName: 'rec2.wav', durationSeconds: 30, createdAt: new Date().toISOString(), remoteNumber: null, operatorLabel: null },
    ],
    total: 2,
    page: 1,
    limit: 20,
    totalPages: 1,
  };

  it('renders recordings list', async () => {
    (api.listRecordings as any).mockResolvedValue(mockRecordings);
    (api.listFlows as any).mockResolvedValue({ data: [] });

    renderWithRouter(<RecordingsPage />);

    await waitFor(() => expect(screen.getByText('call-1')).toBeInTheDocument());
  });

  it('shows number and operator columns with a dash for missing values', async () => {
    (api.listRecordings as any).mockResolvedValue(mockRecordings);
    (api.listFlows as any).mockResolvedValue({ data: [] });

    renderWithRouter(<RecordingsPage />);

    await waitFor(() => expect(screen.getByText('call-1')).toBeInTheDocument());
    expect(screen.getByRole('columnheader', { name: 'number' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'operator' })).toBeInTheDocument();
    expect(screen.getByText('+31612345678')).toBeInTheDocument();
    expect(screen.getByText('101')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  describe('filters and sorting', () => {
    const lastParams = () => {
      const calls = (api.listRecordings as any).mock.calls;
      return calls[calls.length - 1];
    };

    const renderPage = async () => {
      (api.listRecordings as any).mockResolvedValue(mockRecordings);
      renderWithRouter(<RecordingsPage />);
      await waitFor(() => expect(screen.getByText('call-1')).toBeInTheDocument());
    };

    afterEach(() => {
      vi.useRealTimers();
      (api.listRecordings as any).mockReset();
    });

    it('loads with date descending and no filters', async () => {
      await renderPage();

      expect((api.listRecordings as any).mock.calls[0]).toEqual([1, 10, { search: undefined, source: undefined, dateFrom: undefined, dateTo: undefined, sort: 'date', order: 'desc' }]);
      expect(screen.getByRole('columnheader', { name: 'Date' })).toHaveAttribute('aria-sort', 'descending');
    });

    it('sends the debounced search text', async () => {
      await renderPage();
      vi.useFakeTimers({ shouldAdvanceTime: true });

      fireEvent.change(screen.getByLabelText('Search recordings'), { target: { value: ' 3161 ' } });
      expect((api.listRecordings as any).mock.calls.every((call: any[]) => call[2].search === undefined)).toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(400);
      });

      await waitFor(() => expect(lastParams()[2].search).toBe('3161'));
      expect(lastParams()[0]).toBe(1);
    });

    it('sends the source filter and resets to page 1', async () => {
      (api.listRecordings as any).mockResolvedValue({ ...mockRecordings, total: 40, totalPages: 4 });
      renderWithRouter(<RecordingsPage />);
      await waitFor(() => expect(screen.getByText('call-1')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /Older/ }));
      await waitFor(() => expect(lastParams()[0]).toBe(2));

      fireEvent.click(screen.getByRole('button', { name: 'Voicemail' }));

      await waitFor(() => expect(lastParams()[2].source).toBe('voicemail'));
      expect(lastParams()[0]).toBe(1);
    });

    it('sends the date range as UTC day boundaries', async () => {
      await renderPage();

      fireEvent.change(screen.getByLabelText('Date from'), { target: { value: '2026-10-01' } });
      await waitFor(() => expect(lastParams()[2].dateFrom).toBe('2026-10-01T00:00:00.000Z'));
      fireEvent.change(screen.getByLabelText('Date to'), { target: { value: '2026-10-31' } });

      await waitFor(() => expect(lastParams()[2].dateTo).toBe('2026-10-31T23:59:59.999Z'));
      expect(lastParams()[2].dateFrom).toBe('2026-10-01T00:00:00.000Z');
    });

    it('clears all filters', async () => {
      await renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Inbound' }));
      await waitFor(() => expect(lastParams()[2].source).toBe('inbound'));

      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

      await waitFor(() => expect(lastParams()[2].source).toBeUndefined());
      expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    });

    it('toggles the sort order when the same header is clicked again', async () => {
      await renderPage();

      fireEvent.click(screen.getByRole('button', { name: 'Date' }));
      await waitFor(() => expect(lastParams()[2]).toMatchObject({ sort: 'date', order: 'asc' }));
      expect(screen.getByRole('columnheader', { name: 'Date' })).toHaveAttribute('aria-sort', 'ascending');

      fireEvent.click(screen.getByRole('button', { name: 'Date' }));
      await waitFor(() => expect(lastParams()[2]).toMatchObject({ sort: 'date', order: 'desc' }));
    });

    it('sorts a new column ascending and resets to page 1', async () => {
      await renderPage();

      fireEvent.click(screen.getByRole('button', { name: 'number' }));

      await waitFor(() => expect(lastParams()[2]).toMatchObject({ sort: 'number', order: 'asc' }));
      expect(lastParams()[0]).toBe(1);
      expect(screen.getByRole('columnheader', { name: 'number' })).toHaveAttribute('aria-sort', 'ascending');
      expect(screen.getByRole('columnheader', { name: 'Date' })).toHaveAttribute('aria-sort', 'none');
    });

    it('starts duration with the longest first', async () => {
      await renderPage();

      fireEvent.click(screen.getByRole('button', { name: 'Duration' }));

      await waitFor(() => expect(lastParams()[2]).toMatchObject({ sort: 'duration', order: 'desc' }));
    });

    it('shows a filter-specific empty state', async () => {
      (api.listRecordings as any).mockResolvedValue({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
      renderWithRouter(<RecordingsPage />);
      await waitFor(() => expect(screen.getByText(/No recordings yet/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Outbound' }));

      await waitFor(() => expect(screen.getByText('No recordings match the current filters.')).toBeInTheDocument());
    });
  });
});
