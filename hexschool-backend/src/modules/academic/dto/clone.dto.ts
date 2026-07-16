import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/** POST /academic-structure/clone (roadmap M06 §4 — yearly rollover). */
export class CloneStructureDto {
  @IsUUID()
  fromSessionId!: string;

  @IsUUID()
  toSessionId!: string;

  /** true = dry-run: report what WOULD be created, change nothing. */
  @IsOptional()
  @IsBoolean()
  preview?: boolean;
}
