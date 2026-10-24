import { BadGatewayException, Body, Controller, Get, Patch } from '@nestjs/common';
import { AsteriskConfigService } from '../asterisk/asterisk-config.service';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly asteriskConfigService: AsteriskConfigService,
  ) {}

  @Get()
  async getSettings() {
    return this.settingsService.getAll();
  }

  @Patch()
  async updateSettings(@Body() patch: Record<string, boolean | number | string | null>) {
    const settings = await this.settingsService.updateMany(patch);
    if ('rtp_port_start' in patch || 'rtp_port_end' in patch) {
      try {
        await this.asteriskConfigService.syncRtpConfig({
          start: Number(settings.rtp_port_start),
          end: Number(settings.rtp_port_end),
        });
      } catch {
        throw new BadGatewayException(
          'RTP range saved, but Asterisk could not reload rtp.conf. Restart the asterisk container to apply it.',
        );
      }
    }
    return settings;
  }

  @Get('default-trunk')
  async getDefaultTrunk() {
    return this.settingsService.getDefaultTrunk();
  }
}
