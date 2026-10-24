import { Controller, Get } from '@nestjs/common';
import { getSipTlsStatus } from './sip-tls';

@Controller('config')
export class ConfigController {
  @Get('host')
  async getHostConfig() {
    return {
      hostIp: process.env.HOST_IP || '127.0.0.1',
      sipPort: Number(process.env.SIP_PORT || 5080),
      sipTls: await getSipTlsStatus(),
    };
  }
}
