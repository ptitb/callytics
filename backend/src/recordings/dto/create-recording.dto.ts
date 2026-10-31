import { IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export const RECORDING_TYPES = ['inbound', 'outbound', 'voicemail'] as const;
export type RecordingType = (typeof RECORDING_TYPES)[number];

export class CreateRecordingDto {
  @IsString()
  callId!: string;

  @IsString()
  channelId!: string;

  @IsOptional()
  @IsInt()
  flowId?: number | null;

  @IsString()
  fileName!: string;

  @IsString()
  filePath!: string;

  @IsString()
  format!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number | null;

  @IsDateString()
  startedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remoteNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  operatorLabel?: string | null;

  @IsOptional()
  @IsIn(RECORDING_TYPES)
  recordingType?: RecordingType;

  @IsOptional()
  @IsDateString()
  endedAt?: string | null;
}
