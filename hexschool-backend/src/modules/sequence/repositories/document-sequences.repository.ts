import { Injectable } from '@nestjs/common';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * Counter table for gap-free document numbers (one row per school+prefix).
 * The upsert takes a row lock, so concurrent transactions serialize on the
 * same counter; run it inside the CALLER's transaction — if the enclosing
 * write rolls back, the increment rolls back with it and no number is
 * burned. Raw SQL lives here per the repository-pattern rule.
 */
@Injectable()
export class DocumentSequencesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Atomically claims and returns the next value of a counter (1-based). */
  async nextValue(
    schoolId: string,
    prefix: string,
    tx?: PrismaClientLike,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    // next_value stores the value the NEXT caller will get, so the row
    // reads correctly at rest; RETURNING hands back the claimed one.
    const rows = await client.$queryRaw<Array<{ value: number }>>`
      INSERT INTO document_sequences (school_id, prefix, next_value, updated_at)
      VALUES (${schoolId}::uuid, ${prefix}, 2, now())
      ON CONFLICT (school_id, prefix)
      DO UPDATE SET next_value = document_sequences.next_value + 1,
                    updated_at = now()
      RETURNING next_value - 1 AS value
    `;
    return Number(rows[0].value);
  }
}
