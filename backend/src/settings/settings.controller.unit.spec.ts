import { BadGatewayException } from '@nestjs/common';
import { SettingsController } from './settings.controller';

describe('SettingsController outbound dialing', () => {
  const settingsService = { updateMany: jest.fn() };
  const asteriskConfigService = { syncRtpConfig: jest.fn(), syncDialplan: jest.fn() };
  const controller = new SettingsController(settingsService as never, asteriskConfigService as never);

  beforeEach(() => {
    jest.clearAllMocks();
    settingsService.updateMany.mockResolvedValue({ outbound_dial_without_hash: false });
  });

  it('regenerates and reloads the dialplan when dial without # changes', async () => {
    await expect(controller.updateSettings({ outbound_dial_without_hash: false })).resolves.toEqual({
      outbound_dial_without_hash: false,
    });
    expect(asteriskConfigService.syncDialplan).toHaveBeenCalledTimes(1);
  });

  it('does not touch the dialplan for settings stasis reads at call time', async () => {
    await controller.updateSettings({ outbound_country_code: '44', outbound_normalize_e164: false });
    expect(asteriskConfigService.syncDialplan).not.toHaveBeenCalled();
  });

  it('returns 502 when the dialplan reload fails', async () => {
    asteriskConfigService.syncDialplan.mockRejectedValue(new Error('ami down'));
    const result = controller.updateSettings({ outbound_dial_without_hash: true });
    await expect(result).rejects.toBeInstanceOf(BadGatewayException);
    await expect(result).rejects.toThrow('could not reload the dialplan');
  });
});
