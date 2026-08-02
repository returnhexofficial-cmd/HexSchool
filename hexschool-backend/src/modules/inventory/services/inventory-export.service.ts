import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { InventoryReportQueryDto, ItemLedgerQueryDto } from '../dto';
import { InventoryReportsService } from './inventory-reports.service';

export interface ExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Report files. The shapes come from `InventoryReportsService`, so the
 * sheet and the screen are the same numbers (the M12 reports/export
 * split).
 *
 * The asset register is the one that gets a PDF as well as a sheet: it is
 * what somebody carries around a building with a pen, ticking off what
 * they can actually see — which is also why it prints the tag first and
 * leaves a blank column at the right-hand edge.
 */
@Injectable()
export class InventoryExportService {
  constructor(private readonly reports: InventoryReportsService) {}

  async stockXlsx(
    schoolId: string,
    query: InventoryReportQueryDto = {},
  ): Promise<ExportFile> {
    const report = await this.reports.stockValuation(schoolId, query);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Stock');

    sheet.columns = [
      { header: 'Code', key: 'itemCode', width: 16 },
      { header: 'Item', key: 'itemName', width: 32 },
      { header: 'Category', key: 'categoryName', width: 20 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Unit', key: 'unit', width: 10 },
      { header: 'Balance', key: 'balance', width: 12 },
      { header: 'Reorder level', key: 'reorderLevel', width: 14 },
      { header: 'Last unit cost', key: 'lastUnitCost', width: 14 },
      { header: 'Value', key: 'value', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const row of report.rows) sheet.addRow(row);

    // The method, on the sheet. A valuation total whose basis is not
    // written beside it will be read as FIFO by whoever opens it next.
    sheet.addRow({});
    sheet.addRow({ itemName: 'Total value', value: report.totalValue });
    sheet.addRow({
      itemName: 'Valuation method',
      categoryName: report.valuationMethod,
    });
    sheet.addRow({ itemName: report.valuationNote });
    if (report.unvaluedItems > 0) {
      sheet.addRow({
        itemName: `${report.unvaluedItems} item(s) in stock have never been priced and are excluded from the total`,
      });
    }

    return this.xlsx(workbook, 'stock-valuation.xlsx');
  }

  async itemLedgerXlsx(
    schoolId: string,
    itemId: string,
    query: ItemLedgerQueryDto = {},
  ): Promise<ExportFile> {
    const report = await this.reports.itemLedger(schoolId, itemId, query);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Ledger');

    sheet.columns = [
      { header: 'Date', key: 'date', width: 20 },
      { header: 'Movement', key: 'txn', width: 14 },
      { header: 'In', key: 'qtyIn', width: 10 },
      { header: 'Out', key: 'qtyOut', width: 10 },
      { header: 'Balance', key: 'balanceAfter', width: 12 },
      { header: 'Reference', key: 'refType', width: 16 },
      { header: 'Remarks', key: 'remarks', width: 46 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const row of report.rows) {
      sheet.addRow({ ...row, date: row.createdAt });
    }

    return this.xlsx(
      workbook,
      `item-ledger-${report.item.code || report.item.id}.xlsx`,
    );
  }

  async purchasesXlsx(
    schoolId: string,
    query: InventoryReportQueryDto = {},
  ): Promise<ExportFile> {
    const report = await this.reports.purchaseSummary(schoolId, query);
    const workbook = new ExcelJS.Workbook();

    const bySupplier = workbook.addWorksheet('By supplier');
    bySupplier.columns = [
      { header: 'Supplier', key: 'supplierName', width: 32 },
      { header: 'Purchases', key: 'purchases', width: 12 },
      { header: 'Total', key: 'total', width: 16 },
    ];
    bySupplier.getRow(1).font = { bold: true };
    for (const row of report.bySupplier) bySupplier.addRow(row);

    const byMonth = workbook.addWorksheet('By month');
    byMonth.columns = [
      { header: 'Month', key: 'month', width: 12 },
      { header: 'Purchases', key: 'purchases', width: 12 },
      { header: 'Total', key: 'total', width: 16 },
    ];
    byMonth.getRow(1).font = { bold: true };
    for (const row of report.byMonth) byMonth.addRow(row);

    const detail = workbook.addWorksheet('Purchases');
    detail.columns = [
      { header: 'Number', key: 'purchaseNo', width: 18 },
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Supplier', key: 'supplierName', width: 30 },
      { header: 'Invoice ref', key: 'invoiceRef', width: 18 },
      { header: 'Lines', key: 'lines', width: 8 },
      { header: 'Total', key: 'total', width: 16 },
    ];
    detail.getRow(1).font = { bold: true };
    for (const row of report.purchaseList) detail.addRow(row);

    return this.xlsx(workbook, 'purchases.xlsx');
  }

  async assetsXlsx(
    schoolId: string,
    query: InventoryReportQueryDto = {},
  ): Promise<ExportFile> {
    const report = await this.reports.assetRegister(schoolId, query);
    const workbook = new ExcelJS.Workbook();

    const sheet = workbook.addWorksheet('Asset register');
    sheet.columns = [
      { header: 'Tag', key: 'assetTag', width: 16 },
      { header: 'Item', key: 'itemName', width: 30 },
      { header: 'Category', key: 'categoryName', width: 20 },
      { header: 'Serial', key: 'serialNo', width: 20 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Condition', key: 'condition', width: 14 },
      { header: 'Location', key: 'location', width: 24 },
      { header: 'Custodian', key: 'custodian', width: 28 },
      { header: 'Bought', key: 'purchaseDate', width: 14 },
      { header: 'Price', key: 'purchasePrice', width: 14 },
      { header: 'Warranty', key: 'warrantyUntil', width: 14 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const row of report.rows) {
      sheet.addRow({ ...row, warrantyUntil: row.warranty.until });
    }

    // Written-off units on their own sheet: excluded from the register
    // (roadmap §6) but never dropped, because "what happened to the
    // projector" is the question an audit actually asks.
    const off = workbook.addWorksheet('Written off');
    off.columns = [
      { header: 'Tag', key: 'assetTag', width: 16 },
      { header: 'Item', key: 'itemName', width: 30 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Date', key: 'disposedAt', width: 14 },
      { header: 'Reason', key: 'reason', width: 50 },
    ];
    off.getRow(1).font = { bold: true };
    for (const row of report.writtenOff) off.addRow(row);

    return this.xlsx(workbook, 'asset-register.xlsx');
  }

  async warrantyXlsx(schoolId: string, days?: number): Promise<ExportFile> {
    const report = await this.reports.warranty(schoolId, days);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Warranties');
    sheet.columns = [
      { header: 'Tag', key: 'assetTag', width: 16 },
      { header: 'Item', key: 'itemName', width: 30 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Location', key: 'location', width: 24 },
      { header: 'Warranty until', key: 'warrantyUntil', width: 16 },
      { header: 'State', key: 'state', width: 12 },
      { header: 'Days left', key: 'daysLeft', width: 12 },
      { header: 'Note', key: 'message', width: 44 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const row of report.rows) sheet.addRow(row);
    return this.xlsx(workbook, 'warranties-expiring.xlsx');
  }

  async consumptionXlsx(
    schoolId: string,
    query: InventoryReportQueryDto = {},
  ): Promise<ExportFile> {
    const report = await this.reports.consumption(schoolId, query);
    const workbook = new ExcelJS.Workbook();

    const summary = workbook.addWorksheet('By holder');
    summary.columns = [
      { header: 'Holder', key: 'holder', width: 34 },
      { header: 'Quantity', key: 'quantity', width: 14 },
      { header: 'Value', key: 'value', width: 16 },
    ];
    summary.getRow(1).font = { bold: true };
    for (const group of report.groups) summary.addRow(group);

    const detail = workbook.addWorksheet('By item');
    detail.columns = [
      { header: 'Holder', key: 'holder', width: 34 },
      { header: 'Item', key: 'itemName', width: 30 },
      { header: 'Quantity', key: 'quantity', width: 14 },
      { header: 'Value', key: 'value', width: 16 },
    ];
    detail.getRow(1).font = { bold: true };
    for (const group of report.groups) {
      for (const item of group.items) {
        detail.addRow({ holder: group.holder, ...item });
      }
    }

    return this.xlsx(workbook, 'consumption.xlsx');
  }

  /**
   * The stock-check sheet: the register laid out to be carried around a
   * building. Plain pdfkit output — unbranded, and the default font
   * cannot set Bangla (the limitation flagged since M09 ID cards), so
   * `name_bn` is stored and never printed here.
   */
  async assetsPdf(
    schoolId: string,
    query: InventoryReportQueryDto = {},
  ): Promise<ExportFile> {
    const report = await this.reports.assetRegister(schoolId, query);

    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 32,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    doc.fontSize(16).text('Asset register', { align: 'center' });
    doc
      .fontSize(9)
      .text(
        `${report.counts.onBooks} unit(s) on the books · ${report.counts.disposed} disposed · ${report.counts.lost} lost`,
        { align: 'center' },
      );
    doc.moveDown(0.8);

    const columns: Array<[string, number]> = [
      ['Tag', 80],
      ['Item', 150],
      ['Status', 70],
      ['Condition', 70],
      ['Location', 130],
      ['Custodian', 150],
      ['Seen?', 60],
    ];

    const header = () => {
      let x = doc.x;
      const y = doc.y;
      doc.fontSize(9).font('Helvetica-Bold');
      for (const [label, width] of columns) {
        doc.text(label, x, y, { width });
        x += width;
      }
      doc.font('Helvetica');
      doc.moveDown(0.4);
      doc
        .moveTo(32, doc.y)
        .lineTo(doc.page.width - 32, doc.y)
        .stroke();
      doc.moveDown(0.3);
    };

    header();
    for (const row of report.rows) {
      if (doc.y > doc.page.height - 60) {
        doc.addPage();
        header();
      }
      const values = [
        row.assetTag,
        row.itemName,
        row.status,
        row.condition,
        row.location ?? '',
        row.custodian,
        // Deliberately blank: this is the column somebody ticks.
        '',
      ];
      let x = 32;
      const y = doc.y;
      doc.fontSize(8);
      values.forEach((value, index) => {
        doc.text(String(value), x, y, { width: columns[index][1] - 4 });
        x += columns[index][1];
      });
      doc.moveDown(0.9);
    }

    doc.end();
    await new Promise<void>((resolve) => doc.on('end', () => resolve()));

    return {
      buffer: Buffer.concat(chunks),
      filename: 'asset-register.pdf',
      contentType: 'application/pdf',
    };
  }

  private async xlsx(
    workbook: ExcelJS.Workbook,
    filename: string,
  ): Promise<ExportFile> {
    const buffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(buffer),
      filename,
      contentType: XLSX_TYPE,
    };
  }
}
