import { Injectable } from '@nestjs/common';
import { Donation, Visitor } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { dhakaDisplayDate } from '../../../common/utils/clock.util';

/** A6 landscape — a gate pass is a card, not a page. */
const PASS_W = 419.53;
const PASS_H = 297.64;
/** A5 portrait for a receipt, the M16/M21 counter-document size. */
const RECEIPT_W = 419.53;
const RECEIPT_H = 595.28;
const MARGIN = 28;

/**
 * Roadmap §4's "gate pass PDF" and "receipt PDF".
 *
 * Both are **plain pdfkit output**, and both carry the limitation this
 * codebase has flagged since M09 ID cards: the default font **cannot set
 * Bangla**, so a Bangla donor name renders transliterated or not at all.
 * That is a font-embedding job the whole system needs at once, and it is
 * recorded as debt rather than solved differently in a ninth module.
 *
 * A gate pass is deliberately **A6 landscape**: it is worn or carried, and
 * printing one on A4 produces a sheet of paper nobody keeps in their hand.
 * A receipt is A5 portrait, the size M16 receipts and M21 payslips already
 * use, so a school buys one kind of paper for the counter.
 */
@Injectable()
export class CommunityPdfService {
  constructor(private readonly schools: SchoolsRepository) {}

  async gatePass(
    visitor: Visitor,
    schoolId: string,
    hostName: string | null,
  ): Promise<Buffer> {
    const school = await this.schools.findByIdOrFail(schoolId);
    const doc = new PDFDocument({
      size: [PASS_W, PASS_H],
      margin: MARGIN,
      info: { Title: `Gate pass ${visitor.gatePassNo ?? visitor.name}` },
    });
    const done = this.collect(doc);

    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text(school.name, { align: 'center' });
    doc.fontSize(9).font('Helvetica').text('VISITOR PASS', { align: 'center' });
    doc.moveDown(0.6);

    // The pass number is the largest thing on the card, because it is what
    // the gate is checked against and it is read at arm's length.
    if (visitor.gatePassNo) {
      doc
        .fontSize(20)
        .font('Helvetica-Bold')
        .text(visitor.gatePassNo, { align: 'center' });
      doc.moveDown(0.4);
    }

    doc.fontSize(10).font('Helvetica');
    const rows: Array<[string, string]> = [
      ['Name', visitor.name],
      ['Phone', visitor.phone],
      ['Purpose', visitor.purpose],
      ['To meet', hostName ?? visitor.whomToMeet ?? '—'],
      [
        'Checked in',
        visitor.checkIn.toISOString().slice(0, 16).replace('T', ' '),
      ],
      [
        'Valid until',
        visitor.validUntil
          ? dhakaDisplayDate(visitor.validUntil)
          : 'Today only',
      ],
    ];
    if (visitor.cardNo) rows.push(['Card', visitor.cardNo]);

    for (const [label, value] of rows) {
      doc
        .font('Helvetica-Bold')
        .text(`${label}: `, { continued: true })
        .font('Helvetica')
        .text(value);
    }

    doc.moveDown(0.8);
    doc
      .fontSize(7)
      .fillColor('#555')
      .text(
        'Please return this pass at the gate when you leave. This pass admits the named holder only.',
        { align: 'center' },
      );

    doc.end();
    return done;
  }

  async donationReceipt(donation: Donation, schoolId: string): Promise<Buffer> {
    const school = await this.schools.findByIdOrFail(schoolId);
    const doc = new PDFDocument({
      size: [RECEIPT_W, RECEIPT_H],
      margin: MARGIN,
      info: { Title: `Donation receipt ${donation.receiptNo}` },
    });
    const done = this.collect(doc);

    doc
      .fontSize(15)
      .font('Helvetica-Bold')
      .text(school.name, { align: 'center' });
    if (school.address) {
      doc
        .fontSize(8)
        .font('Helvetica')
        .text(school.address, { align: 'center' });
    }
    doc.moveDown(0.4);
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .text('DONATION RECEIPT', { align: 'center' });
    doc.moveDown(0.8);

    doc.fontSize(10).font('Helvetica');
    const rows: Array<[string, string]> = [
      ['Receipt no', donation.receiptNo],
      ['Date', dhakaDisplayDate(donation.receivedAt)],
      ['Received from', donation.donorName],
      ['Amount', `BDT ${Number(donation.amount).toFixed(2)}`],
      ['Method', donation.method],
      ['Purpose', donation.purpose ?? 'General fund'],
    ];

    for (const [label, value] of rows) {
      doc
        .font('Helvetica-Bold')
        .text(`${label}: `, { continued: true })
        .font('Helvetica')
        .text(value);
    }

    // A cancelled receipt still prints — the register keeps it (roadmap
    // §6) — and it says so across its face, because a cancelled document
    // and a live one must never look the same to whoever is holding them
    // (the M27 REVOKED rule).
    if (donation.cancelledAt) {
      doc.moveDown(1);
      doc
        .fontSize(16)
        .fillColor('#b00')
        .font('Helvetica-Bold')
        .text('CANCELLED', { align: 'center' });
      doc
        .fontSize(9)
        .font('Helvetica')
        .text(
          `Cancelled on ${dhakaDisplayDate(donation.cancelledAt)} — ${donation.cancelledReason ?? ''}`,
          { align: 'center' },
        );
      doc.fillColor('#000');
    }

    doc.moveDown(3);
    doc.fontSize(9).text('_______________________', { align: 'right' });
    doc.text('Received by', { align: 'right' });

    doc.moveDown(1.5);
    doc
      .fontSize(7)
      .fillColor('#555')
      .text(
        'Thank you for supporting the school. This receipt is issued against the donation register and cannot be amended — a correction is a cancellation with a reason.',
        { align: 'center' },
      );

    doc.end();
    return done;
  }

  private collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    return new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
  }
}
