import { Injectable } from '@nestjs/common';
import { PrismaClientLike } from '../../common/database/base.repository';
import { DocumentSequencesRepository } from './repositories/document-sequences.repository';

/**
 * Shared document-number generator (PROJECT_CONTEXT §3): gap-free,
 * per-school sequences rendered through a token pattern. Introduced for
 * employee IDs (M07); student UIDs, application/invoice/voucher numbers
 * (M09/M10/M16/M20) reuse it with their own patterns and counter keys.
 *
 * Pattern tokens: {SCHOOL_CODE} {YYYY} {YY} {MM} {SEQ<n>} (zero-padded
 * to n digits — overflowing values keep all their digits).
 */
@Injectable()
export class SequenceService {
  constructor(private readonly sequences: DocumentSequencesRepository) {}

  /**
   * Claims the next number for `counterKey` and renders `pattern`.
   * Pass the enclosing transaction so a rolled-back create never burns
   * a number (the gap-free guarantee).
   */
  async nextDocumentNumber(params: {
    schoolId: string;
    /** Counter identity, e.g. `staff:26` (yearly) or `invoice:2607`. */
    counterKey: string;
    pattern: string;
    schoolCode: string;
    /** Drives the date tokens; defaults to now. */
    date?: Date;
    tx?: PrismaClientLike;
  }): Promise<string> {
    const seq = await this.sequences.nextValue(
      params.schoolId,
      params.counterKey,
      params.tx,
    );
    return this.render(params.pattern, {
      schoolCode: params.schoolCode,
      seq,
      date: params.date ?? new Date(),
    });
  }

  /** Pure pattern rendering (exposed for tests/previews). */
  render(
    pattern: string,
    tokens: { schoolCode: string; seq: number; date: Date },
  ): string {
    const yyyy = String(tokens.date.getUTCFullYear());
    const mm = String(tokens.date.getUTCMonth() + 1).padStart(2, '0');
    return pattern
      .replaceAll('{SCHOOL_CODE}', tokens.schoolCode)
      .replaceAll('{YYYY}', yyyy)
      .replaceAll('{YY}', yyyy.slice(2))
      .replaceAll('{MM}', mm)
      .replace(/\{SEQ(\d+)\}/g, (_, width: string) =>
        String(tokens.seq).padStart(Number(width), '0'),
      );
  }
}
