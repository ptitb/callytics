import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { EXTENSION_TRANSPORT_TYPES, ExtensionTransportType } from '../extension-transport';

export class CreateExtensionDto {
  @IsString()
  @MaxLength(64)
  username!: string;

  @IsString()
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  displayName?: string;

  @IsOptional()
  @IsString()
  @IsIn(EXTENSION_TRANSPORT_TYPES)
  transportType?: ExtensionTransportType;

  @IsOptional()
  @IsBoolean()
  vpnOnly?: boolean;
}
