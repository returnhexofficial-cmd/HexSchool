import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class CreateAssignmentDto {
  @IsUUID()
  sessionId!: string;

  @IsUUID()
  sectionId!: string;

  @IsUUID()
  subjectId!: string;

  @IsUUID()
  teacherId!: string;

  /** Assign despite missing expertise (needs teacher.assign.override). */
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

export class AssignmentQueryDto {
  @IsUUID()
  sessionId!: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsUUID()
  teacherId?: string;
}

export class WorkloadQueryDto {
  @IsUUID()
  sessionId!: string;
}
