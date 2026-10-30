import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import { SettingsPage } from './SettingsPage';
import { renderWithRouter } from '../test/renderWithRouter';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

describe('SettingsPage coverage boost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSettings).mockResolvedValue({
      default_outbound_trunk_id: null,
      record_outbound_calls: false,
      recording_retention_days: 0,
      rtp_port_start: 10000,
      rtp_port_end: 20000,
      outbound_dial_without_hash: true,
      outbound_normalize_e164: true,
      outbound_country_code: '31',
      outbound_international_prefix: '00',
      outbound_wait_audio: 'ringback',
    });
    vi.mocked(api.updateSettings).mockResolvedValue({
      default_outbound_trunk_id: null,
      record_outbound_calls: false,
      recording_retention_days: 0,
      rtp_port_start: 10000,
      rtp_port_end: 20000,
      outbound_dial_without_hash: true,
      outbound_normalize_e164: true,
      outbound_country_code: '31',
      outbound_international_prefix: '00',
      outbound_wait_audio: 'ringback',
    });
  });

  it('renders retention settings content', async () => {
    renderWithRouter(<SettingsPage />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Recordings' })).toBeInTheDocument();
    expect(screen.getByText('Set to 0 to keep recordings indefinitely.')).toBeInTheDocument();
  });

  it('renders the outbound dialing section with the loaded values', async () => {
    vi.mocked(api.getSettings).mockResolvedValue({
      ...(await api.getSettings()),
      outbound_dial_without_hash: false,
      outbound_country_code: '44',
      outbound_international_prefix: '011',
      outbound_wait_audio: 'moh',
    });
    renderWithRouter(<SettingsPage />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Outbound dialing' })).toBeInTheDocument());
    expect(screen.getByLabelText('Dial external numbers without #')).not.toBeChecked();
    expect(screen.getByLabelText('Convert dialed numbers to E.164')).toBeChecked();
    expect(screen.getByLabelText('Country code')).toHaveValue('44');
    expect(screen.getByLabelText('International prefix')).toHaveValue('011');
    expect(screen.getByLabelText('Waiting audio while dialing out')).toHaveValue('moh');
    expect(screen.getByRole('option', { name: 'Ringback tone' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Hold music' })).toBeInTheDocument();
    expect(screen.getByText(/0612345678 becomes \+31612345678/)).toBeInTheDocument();
  });

  it('saves the outbound dialing settings', async () => {
    renderWithRouter(<SettingsPage />);
    await screen.findByRole('heading', { name: 'Outbound dialing' });

    fireEvent.click(screen.getByLabelText('Dial external numbers without #'));
    fireEvent.click(screen.getByLabelText('Convert dialed numbers to E.164'));
    fireEvent.change(screen.getByLabelText('Country code'), { target: { value: '44' } });
    fireEvent.change(screen.getByLabelText('International prefix'), { target: { value: '011' } });
    fireEvent.change(screen.getByLabelText('Waiting audio while dialing out'), { target: { value: 'moh' } });
    const saveButtons = screen.getAllByRole('button', { name: 'save' });
    fireEvent.click(saveButtons[2]);

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({
      outbound_dial_without_hash: false,
      outbound_normalize_e164: false,
      outbound_country_code: '44',
      outbound_international_prefix: '011',
      outbound_wait_audio: 'moh',
    }));
  });

  it('does not save an invalid country code or prefix', async () => {
    renderWithRouter(<SettingsPage />);
    await screen.findByRole('heading', { name: 'Outbound dialing' });
    const save = () => fireEvent.click(screen.getAllByRole('button', { name: /save|failed/ })[2]);

    fireEvent.change(screen.getByLabelText('Country code'), { target: { value: '+31' } });
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Country code must be 1 to 3 digits');

    fireEvent.change(screen.getByLabelText('Country code'), { target: { value: '31' } });
    fireEvent.change(screen.getByLabelText('International prefix'), { target: { value: '' } });
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent('International prefix must be 1 to 4 digits');
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it('shows the backend message when the dialplan reload fails', async () => {
    const error = new axios.AxiosError('bad gateway', 'ERR_BAD_RESPONSE', undefined, undefined, {
      status: 502,
      data: { message: 'Outbound dialing settings saved, but Asterisk could not reload the dialplan.' },
    } as never);
    vi.mocked(api.updateSettings).mockRejectedValue(error);
    renderWithRouter(<SettingsPage />);
    await screen.findByRole('heading', { name: 'Outbound dialing' });

    fireEvent.click(screen.getAllByRole('button', { name: 'save' })[2]);

    expect(await screen.findByRole('alert')).toHaveTextContent('could not reload the dialplan');
  });
});
