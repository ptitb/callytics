import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AsteriskModule } from '../asterisk/asterisk.module';
import { SipTrunkEntity } from '../trunks/entities/sip-trunk.entity';
import { SettingsController } from './settings.controller';
import { SettingsEntity } from './settings.entity';
import { SettingsService } from './settings.service';

@Module({
  imports: [TypeOrmModule.forFeature([SettingsEntity, SipTrunkEntity]), AsteriskModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
