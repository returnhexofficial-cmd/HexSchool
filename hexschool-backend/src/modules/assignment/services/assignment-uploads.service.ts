import {
  BadRequestException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';
import { fileIssues } from '../calc/attachment.util';
import {
  ASSIGNMENT_BUCKET_PURPOSE,
  ASSIGNMENT_PREFIX,
  ATTACHMENT_SCANNER,
  MATERIAL_PREFIX,
  SUBMISSION_PREFIX,
  type AttachmentScanner,
} from '../assignment.constants';
import { AssignmentSettingsService } from './assignment-settings.service';

export type UploadKind = 'assignment' | 'submission' | 'material';

export interface UploadedAttachment {
  key: string;
  name: string;
  size: number;
  contentType: string;
  /** Signed for an hour — the M04 rule: the KEY is the stable reference. */
  url: string;
}

const PREFIXES: Record<UploadKind, string> = {
  assignment: ASSIGNMENT_PREFIX,
  submission: SUBMISSION_PREFIX,
  material: MATERIAL_PREFIX,
};

/**
 * Uploads for assignments, submissions and learning materials.
 *
 * Two-step by design (the M19 download/CV precedent): the client uploads
 * here, gets back an object **key**, and sends that key in the create or
 * submit call. A one-step multipart create would mean the whole form has
 * to be re-typed when a 9 MB file is refused, on a phone, at 11 pm.
 *
 * Every upload passes the `ATTACHMENT_SCANNER` hook (roadmap §4's
 * virus-scan placeholder), which ships bound to a pass-through and is one
 * provider swap from ClamAV — see `assignment.constants.ts`.
 */
@Injectable()
export class AssignmentUploadsService {
  constructor(
    private readonly storage: StorageService,
    private readonly config: AssignmentSettingsService,
    @Inject(ATTACHMENT_SCANNER) private readonly scanner: AttachmentScanner,
  ) {}

  async upload(
    file: Express.Multer.File | undefined,
    kind: UploadKind,
    schoolId: string,
  ): Promise<UploadedAttachment> {
    if (!file) throw new BadRequestException('No file was uploaded');

    const cfg = await this.config.load(schoolId);
    const issues = fileIssues(
      { name: file.originalname, size: file.size },
      cfg.limits,
    );
    if (issues.length > 0) {
      throw new BadRequestException({
        message: 'The file was refused',
        details: { issues },
      });
    }

    const scan = await this.scanner.scan({
      buffer: file.buffer,
      filename: file.originalname,
      contentType: file.mimetype,
    });
    if (!scan.clean) {
      throw new UnprocessableEntityException(
        scan.reason ?? 'The file failed the virus scan',
      );
    }

    const result = await this.storage.upload({
      body: file.buffer,
      contentType: file.mimetype,
      filename: file.originalname,
      prefix: `${PREFIXES[kind]}/${schoolId}`,
      purpose: ASSIGNMENT_BUCKET_PURPOSE,
    });

    return {
      key: result.key,
      name: file.originalname,
      size: file.size,
      contentType: file.mimetype,
      url: result.url,
    };
  }

  /** Re-signs a stored key so a portal can render a download link. */
  async signedUrl(key: string): Promise<string> {
    return this.storage.getSignedUrl(key, 3600, ASSIGNMENT_BUCKET_PURPOSE);
  }
}
