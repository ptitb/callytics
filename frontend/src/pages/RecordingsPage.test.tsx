import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
});
