import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export const TEMPLATE_NAME_MAX_LENGTH = 120;
export const TEMPLATE_CATEGORY_MAX_LENGTH = 60;
export const TEMPLATE_DESCRIPTION_MAX_LENGTH = 500;

export class CreateTemplateDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  flowId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(TEMPLATE_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(TEMPLATE_CATEGORY_MAX_LENGTH)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(TEMPLATE_DESCRIPTION_MAX_LENGTH)
  description?: string;
}
