import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AdmissionApplicationStatus,
  AdmissionPaymentStatus,
} from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ApplicationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  cycleId?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsEnum(AdmissionApplicationStatus)
  status?: AdmissionApplicationStatus;

  @IsOptional()
  @IsEnum(AdmissionPaymentStatus)
  paymentStatus?: AdmissionPaymentStatus;
}

/** Manual review transitions only — engine-owned statuses (PASSED,
 *  SELECTED, ADMITTED, EXPIRED…) are set by their own endpoints. */
export class UpdateApplicationStatusDto {
  @IsEnum(AdmissionApplicationStatus)
  status!: AdmissionApplicationStatus;

  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;
}

/** Offline application-fee payment record (roadmap M10 §2 — online
 *  gateway wiring arrives with Module 16). */
export class RecordPaymentDto {
  @IsString()
  @IsIn(['CASH', 'BANK', 'BKASH', 'NAGAD', 'ROCKET', 'OTHER'])
  method!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;
}

export class SetPaymentStatusDto {
  @IsEnum(AdmissionPaymentStatus)
  @IsIn([AdmissionPaymentStatus.WAIVED, AdmissionPaymentStatus.REFUNDED])
  status!: AdmissionPaymentStatus;

  @IsString()
  @Length(3, 500)
  reason!: string;
}
