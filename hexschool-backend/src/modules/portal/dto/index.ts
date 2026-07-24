import { IsOptional, IsUUID } from 'class-validator';

/** Trigger the automatic withhold-on-dues for an exam. */
export class WithholdDuesDto {
  @IsUUID()
  examId!: string;
}

/** Fire the dues-reminder blast for a session (defaults to current). */
export class DuesRemindersDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}
