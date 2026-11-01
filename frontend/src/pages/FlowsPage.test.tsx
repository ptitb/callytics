import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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
  createTemplate: vi.fn(),
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

  it('saves a flow as template from the dialog and shows a toast', async () => {
    vi.mocked(api.listFlows).mockResolvedValue(mockFlows);
    vi.mocked(api.createTemplate).mockResolvedValue({ data: { id: 9, name: 'Front desk' } });

    renderWithRouter(<><FlowsPage /><ToastContainer /></>);
    await waitFor(() => expect(screen.getByText('Main Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /save as template/i }));
    const dialog = screen.getByRole('dialog', { name: /save as template/i });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Main Flow');

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Front desk' } });
    fireEvent.change(within(dialog).getByLabelText(/category/i), { target: { value: 'office' } });
    fireEvent.change(within(dialog).getByLabelText(/description/i), { target: { value: 'Opening hours menu' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save template' }));

    await waitFor(() => expect(api.createTemplate).toHaveBeenCalledWith({
      flowId: 1,
      name: 'Front desk',
      category: 'office',
      description: 'Opening hours menu',
    }));
    expect(await screen.findByText(/Saved "Front desk" as template/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the dialog open and shows the error when saving the template fails', async () => {
    vi.mocked(api.listFlows).mockResolvedValue(mockFlows);
    vi.mocked(api.createTemplate).mockRejectedValue(new Error('boom'));

    renderWithRouter(<FlowsPage />);
    await waitFor(() => expect(screen.getByText('Main Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /save as template/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes the dialog on cancel without calling the API', async () => {
    vi.mocked(api.listFlows).mockResolvedValue(mockFlows);
    vi.mocked(api.createTemplate).mockClear();

    renderWithRouter(<FlowsPage />);
    await waitFor(() => expect(screen.getByText('Main Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /save as template/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.createTemplate).not.toHaveBeenCalled();
  });
});
