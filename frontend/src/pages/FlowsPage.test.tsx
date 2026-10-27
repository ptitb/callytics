import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { FlowsPage } from './FlowsPage';
import { ToastContainer } from '../components/ToastContainer';

import * as api from '../lib/api';
import * as flowExport from '../lib/flowExport';
import { renderWithRouter } from '../test/renderWithRouter';

vi.mock('../lib/flowExport', () => ({
  downloadFlowExport: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  listFlows: vi.fn(),
  createFlow: vi.fn(),
  deleteFlow: vi.fn(),
}));

describe('FlowsPage coverage boost', () => {
  const mockFlows = {
    data: [
      { id: 1, name: 'Main Flow', description: 'Main IVR', createdAt: new Date().toISOString() },
    ],
    total: 1,
    page: 1,
    limit: 10,
    totalPages: 1,
  };

  it('renders flows and shows the create button', async () => {
    (api.listFlows as any).mockResolvedValue(mockFlows);

    renderWithRouter(<FlowsPage />);

    await waitFor(() => expect(screen.getByText('Main Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /new flow/i }));
    expect(screen.getByRole('button', { name: /new flow/i })).toBeInTheDocument();
  });

  it('downloads the flow as JSON from the export action', async () => {
    (api.listFlows as any).mockResolvedValue(mockFlows);
    (flowExport.downloadFlowExport as any).mockResolvedValue(undefined);

    renderWithRouter(<FlowsPage />);
    await waitFor(() => expect(screen.getByText('Main Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /export json/i }));

    await waitFor(() => expect(flowExport.downloadFlowExport).toHaveBeenCalledWith(1, 'Main Flow'));
  });

  it('shows a toast when the export fails', async () => {
    (api.listFlows as any).mockResolvedValue(mockFlows);
    (flowExport.downloadFlowExport as any).mockRejectedValue(new Error('export exploded'));

    renderWithRouter(<><FlowsPage /><ToastContainer /></>);
    await waitFor(() => expect(screen.getByText('Main Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /export json/i }));

    expect(await screen.findByText('export exploded')).toBeInTheDocument();
  });
});
