import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class InitiateVideoUploadDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) title: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) filename: string;
  @ApiProperty() @IsString() mimeType: string;
  @ApiProperty({ minimum: 1, maximum: 10_000_000_000 })
  @IsInt()
  @Min(1)
  @Max(10_000_000_000)
  sizeBytes: number;
}

export class SignVideoPartsDto {
  @ApiProperty({ type: [Number], minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  partNumbers: number[];
}

export class VideoPartDto {
  @ApiProperty() @IsInt() @Min(1) partNumber: number;
  @ApiProperty() @IsString() @IsNotEmpty() eTag: string;
}

export class CompleteVideoUploadDto {
  @ApiProperty({ type: [VideoPartDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VideoPartDto)
  parts: VideoPartDto[];
}
