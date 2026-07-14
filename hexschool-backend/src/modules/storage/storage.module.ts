import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/** Global: file uploads are needed by most modules (photos, documents, PDFs). */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
