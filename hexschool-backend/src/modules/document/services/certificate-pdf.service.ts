import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { htmlToText } from '../../website/calc/html-sanitize.util';
import { CertificateIssueKind } from '../../../common/constants';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { StorageService } from '../../storage/storage.service';
import { renderTemplate } from '../../communication/calc/template.engine';
import { verifyUrl } from '../calc/verify-code.util';
import type { CertificateWithRelations } from '../repositories/certificates.repository';
import { DocumentSettingsService } from './document-settings.service';

/** A4 portrait in PDF points. */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;

interface Signatory {
  name?: string;
  designation?: string;
  imageUrl?: string;
}

/**
 * The printed certificate: A4 portrait, the school's stationery scan
 * behind it, the frozen body text, the signatory block, and a QR encoding
 * the verification URL.
 *
 * **The page is rendered from the certificate's OWN frozen columns**, never
 * from the live template — `body_html` and `data_snapshot` were written at
 * issue, so re-printing a 2024 testimonial in 2027 produces the same page
 * even after the layout was redesigned and the student's name corrected
 * (roadmap §6). That is the entire reason those two columns exist.
 *
 * **The body is rendered as TEXT, not as laid-out HTML.** pdfkit has no
 * HTML engine, and the honest options were a headless-browser dependency
 * (a Chromium per print, on a school's VPS) or a converter that silently
 * drops half of what an editor wrote. `htmlToText` — M19's own converter,
 * already golden-tested — gives a faithful, predictable page: paragraphs
 * survive, tables and floats do not. That limitation is stated on the
 * screen where a template is written rather than discovered on a printed
 * certificate, and it is the same trade M09 made for ID cards.
 */
@Injectable()
export class CertificatePdfService {
  private readonly logger = new Logger(CertificatePdfService.name);

  constructor(
    private readonly schools: SchoolsRepository,
    private readonly storage: StorageService,
    private readonly config: DocumentSettingsService,
  ) {}

  async render(
    certificate: CertificateWithRelations,
    schoolId: string,
  ): Promise<Buffer> {
    const [school, config] = await Promise.all([
      this.schools.findByIdOrFail(schoolId),
      this.config.load(schoolId),
    ]);

    const snapshot = (certificate.dataSnapshot ?? {}) as Record<string, string>;
    const background = certificate.template?.id
      ? await this.fetchImage(this.backgroundKey(certificate))
      : null;
    const logo = school.logoUrl ? await this.fetchImage(school.logoUrl) : null;

    const code = certificate.verifyCode ?? '';
    const qr = code
      ? await QRCode.toBuffer(verifyUrl(config.verifyUrlBase, code), {
          errorCorrectionLevel: 'M',
          margin: 0,
          width: 200,
        })
      : null;

    const doc = new PDFDocument({
      size: [PAGE_W, PAGE_H],
      margin: 0,
      autoFirstPage: false,
      info: {
        Title:
          `${certificate.type} certificate ${certificate.certificateNo ?? ''}`.trim(),
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });

    if (background) {
      try {
        doc.image(background, 0, 0, { width: PAGE_W, height: PAGE_H });
      } catch {
        // A stationery scan that will not decode must never stop the
        // office printing a certificate — the M09 undecodable-photo rule.
        this.logger.warn(
          `Undecodable background on certificate ${certificate.id}`,
        );
      }
    }

    // **The watermark goes down before the text**, so a duplicate reads as
    // a duplicate even after somebody photocopies it in greyscale.
    if (certificate.issueKind === CertificateIssueKind.DUPLICATE) {
      this.drawWatermark(doc, config.duplicateWatermarkText);
    }

    this.drawHeader(doc, school.name, snapshot, logo, Boolean(background));
    const bodyEnd = this.drawBody(doc, certificate, snapshot);
    this.drawSignatories(doc, certificate, bodyEnd);
    this.drawFooter(doc, certificate, snapshot, qr);

    doc.end();
    return done;
  }

  /**
   * Renders and stores the PDF, returning the S3 key.
   *
   * A missing object is a **re-render**, not a loss: the two frozen columns
   * are the source of truth and the file is a cache of them, which is why
   * nothing in the register depends on `file_url` being present.
   */
  async renderAndStore(
    certificate: CertificateWithRelations,
    schoolId: string,
  ): Promise<{ pdf: Buffer; key: string | null }> {
    const pdf = await this.render(certificate, schoolId);
    try {
      const stored = await this.storage.upload({
        body: pdf,
        contentType: 'application/pdf',
        prefix: 'certificates',
        filename: `${certificate.certificateNo ?? certificate.id}.pdf`,
        purpose: 'documents',
      });
      return { pdf, key: stored.key };
    } catch (error) {
      this.logger.warn(
        `Certificate ${certificate.id} rendered but not stored: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { pdf, key: null };
    }
  }

  // ── drawing ─────────────────────────────────────────────────────────

  private drawWatermark(doc: PDFKit.PDFDocument, text: string): void {
    doc.save();
    doc
      .rotate(-35, { origin: [PAGE_W / 2, PAGE_H / 2] })
      .fillColor('#d92d20')
      .opacity(0.12)
      .font('Helvetica-Bold')
      .fontSize(96)
      .text(text.toUpperCase(), 0, PAGE_H / 2 - 60, {
        width: PAGE_W,
        align: 'center',
      });
    doc.restore().opacity(1);
  }

  private drawHeader(
    doc: PDFKit.PDFDocument,
    schoolName: string,
    snapshot: Record<string, string>,
    logo: Buffer | null,
    hasBackground: boolean,
  ): void {
    // With the school's own stationery behind it, printing the name again
    // would double it up — the background IS the letterhead.
    if (hasBackground) return;

    if (logo) {
      try {
        doc.image(logo, PAGE_W / 2 - 24, MARGIN - 12, { fit: [48, 48] });
      } catch {
        this.logger.warn('Undecodable school logo on a certificate');
      }
    }
    const top = MARGIN + (logo ? 44 : 0);
    doc
      .fillColor('#111827')
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(schoolName, MARGIN, top, {
        width: PAGE_W - MARGIN * 2,
        align: 'center',
      });

    const subtitle = [
      snapshot.school_address,
      snapshot.school_eiin ? `EIIN ${snapshot.school_eiin}` : '',
    ]
      .filter((part) => part && part.length > 0)
      .join(' · ');
    if (subtitle) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#4b5563')
        .text(subtitle, MARGIN, doc.y + 2, {
          width: PAGE_W - MARGIN * 2,
          align: 'center',
        });
    }
    doc
      .moveTo(MARGIN, doc.y + 10)
      .lineTo(PAGE_W - MARGIN, doc.y + 10)
      .strokeColor('#111827')
      .lineWidth(1.2)
      .stroke();
  }

  private drawBody(
    doc: PDFKit.PDFDocument,
    certificate: CertificateWithRelations,
    snapshot: Record<string, string>,
  ): number {
    const title = `${this.titleFor(certificate.type)}`;
    doc
      .fillColor('#111827')
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(title.toUpperCase(), MARGIN, doc.y + 28, {
        width: PAGE_W - MARGIN * 2,
        align: 'center',
        characterSpacing: 1.5,
      });

    const rendered = certificate.bodyHtml
      ? renderTemplate(certificate.bodyHtml, snapshot)
      : this.fallbackBody(certificate, snapshot);

    doc
      .font('Helvetica')
      .fontSize(12)
      .fillColor('#111827')
      .text(htmlToText(rendered), MARGIN, doc.y + 24, {
        width: PAGE_W - MARGIN * 2,
        align: 'left',
        lineGap: 6,
      });

    return doc.y;
  }

  /**
   * A legacy backfill has no stored layout (there was no template — the
   * school typed it), so the PDF states the facts of the register entry
   * rather than pretending to reproduce a document it never saw.
   */
  private fallbackBody(
    certificate: CertificateWithRelations,
    snapshot: Record<string, string>,
  ): string {
    const lines = [
      `This is to certify that ${snapshot.student_name || 'the student named below'} (ID ${snapshot.student_uid || '—'})`,
      snapshot.class
        ? `of ${snapshot.class}${snapshot.section ? ` (${snapshot.section})` : ''}, session ${snapshot.session || '—'},`
        : '',
      certificate.isLegacy
        ? `was issued a ${this.titleFor(certificate.type).toLowerCase()} numbered ${certificate.certificateNo} by this institution.`
        : `is issued this ${this.titleFor(certificate.type).toLowerCase()} by this institution.`,
      certificate.isLegacy
        ? 'This entry records a certificate issued before the school’s current record system; the original wording is not held here.'
        : '',
    ];
    return lines.filter((line) => line.length > 0).join(' ');
  }

  private drawSignatories(
    doc: PDFKit.PDFDocument,
    certificate: CertificateWithRelations,
    bodyEnd: number,
  ): void {
    const raw = certificate.template
      ? ((certificate.template as unknown as { signatories?: Signatory[] })
          .signatories ?? [])
      : [];
    const signatories = Array.isArray(raw) ? raw.slice(0, 3) : [];
    if (signatories.length === 0) return;

    const y = Math.max(bodyEnd + 70, PAGE_H - 210);
    const width = (PAGE_W - MARGIN * 2) / signatories.length;

    signatories.forEach((signatory, index) => {
      const x = MARGIN + width * index;
      doc
        .moveTo(x + 20, y)
        .lineTo(x + width - 20, y)
        .strokeColor('#111827')
        .lineWidth(0.8)
        .stroke();
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#111827')
        .text(signatory.name ?? '', x, y + 6, { width, align: 'center' });
      if (signatory.designation) {
        doc
          .font('Helvetica')
          .fontSize(8.5)
          .fillColor('#4b5563')
          .text(signatory.designation, x, doc.y, { width, align: 'center' });
      }
    });
  }

  private drawFooter(
    doc: PDFKit.PDFDocument,
    certificate: CertificateWithRelations,
    snapshot: Record<string, string>,
    qr: Buffer | null,
  ): void {
    const y = PAGE_H - 118;

    if (qr) {
      try {
        doc.image(qr, MARGIN, y, { fit: [62, 62] });
      } catch {
        this.logger.warn(`QR could not be drawn on ${certificate.id}`);
      }
    }

    const x = qr ? MARGIN + 72 : MARGIN;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#4b5563')
      .text(
        `Certificate no. ${certificate.certificateNo ?? '—'}   ·   Issued ${snapshot.issue_date || '—'}`,
        x,
        y + 8,
        { width: PAGE_W - x - MARGIN },
      )
      .text(
        `Verify this document with code ${certificate.verifyCode ?? '—'}${
          snapshot.verify_url ? ` at ${snapshot.verify_url}` : ''
        }`,
        x,
        doc.y + 2,
        { width: PAGE_W - x - MARGIN },
      );

    if (snapshot.original_no) {
      doc
        .font('Helvetica-Bold')
        .fillColor('#b42318')
        .text(
          `Duplicate copy of certificate ${snapshot.original_no}. Both copies are valid.`,
          x,
          doc.y + 2,
          { width: PAGE_W - x - MARGIN },
        );
    }
  }

  private titleFor(type: string): string {
    switch (type) {
      case 'TRANSFER':
        return 'Transfer Certificate';
      case 'CHARACTER':
        return 'Character Certificate';
      case 'TESTIMONIAL':
        return 'Testimonial';
      case 'PRIZE':
        return 'Certificate of Achievement';
      case 'PARTICIPATION':
        return 'Certificate of Participation';
      default:
        return 'Certificate';
    }
  }

  private backgroundKey(certificate: CertificateWithRelations): string | null {
    // The template row is the only place the background lives; unlike the
    // body it is not frozen, because a school that rescans its letterhead
    // at higher resolution wants the better scan on the next re-print.
    const template = certificate.template as unknown as {
      backgroundUrl?: string | null;
    } | null;
    return template?.backgroundUrl ?? null;
  }

  private async fetchImage(key: string | null): Promise<Buffer | null> {
    if (!key) return null;
    try {
      return await this.storage.download(key, 'documents');
    } catch (error) {
      this.logger.warn(
        `Could not fetch image ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
