import { Module } from '@nestjs/common';
import { DocumentSequencesRepository } from './repositories/document-sequences.repository';
import { SequenceService } from './sequence.service';

/**
 * Module 07 — shared gap-free document-number sequences. Imported by any
 * module that issues numbered documents (staff M07, students M09,
 * admissions M10, invoices M16, vouchers M20).
 */
@Module({
  providers: [SequenceService, DocumentSequencesRepository],
  exports: [SequenceService],
})
export class SequenceModule {}
