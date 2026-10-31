import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { RECORDING_TYPES, RecordingType } from './create-recording.dto';

export const RECORDING_SORT_FIELDS = ['filename', 'source', 'number', 'operator', 'duration', 'date'] as const;
export type RecordingSortField = (typeof RECORDING_SORT_FIELDS)[number];

export const RECORDING_SORT_ORDERS = ['asc', 'desc'] as const;
export type RecordingSortOrder = (typeof RECORDING_SORT_ORDERS)[number];

export class ListRecordingsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  /** Case-insensitive match on number, operator and filename. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(RECORDING_TYPES)
  source?: RecordingType;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsIn(RECORDING_SORT_FIELDS)
  sort?: RecordingSortField;

  @IsOptional()
  @IsIn(RECORDING_SORT_ORDERS)
  order?: RecordingSortOrder;
}
