import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Who gets an admit card. Exactly one selector is required — a section, a
 * class, or an explicit enrollment list (the single reissue of roadmap
 * §8 is the one-element case).
 */
export class AdmitCardBatchDto {
  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  enrollmentIds?: string[];

  /**
   * Issue despite outstanding dues when `exam.admit_card_block_dues` is
   * on (needs `exam.admit-card.dues-override`). Inert until Module 16
   * binds a real dues gate.
   */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  ignoreDues?: boolean;
}
