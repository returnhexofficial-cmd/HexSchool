import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AttendancePersonType } from '../../../common/constants';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { SkipEnvelope } from '../../../common/decorators/skip-envelope.decorator';
import { isoDate } from '../../academic/calendar/date.util';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import {
  CancelPayrollDto,
  CreateBonusDto,
  CreatePayrollRunDto,
  CreateStructureDto,
  DisbursePayrollDto,
  EditPayslipDto,
  GeneratePayrollDto,
  HoldPayslipDto,
  PayrollQueryDto,
  PayrollReportQueryDto,
  PfEntryDto,
  PreviewStructureDto,
  UpdateBonusDto,
  UpdateStructureDto,
} from '../dto';
import { BonusService } from '../services/bonus.service';
import { HrSettingsService } from '../services/hr-settings.service';
import { PayrollExportService } from '../services/payroll-export.service';
import { PayrollPostingService } from '../services/payroll-posting.service';
import { PayrollReportsService } from '../services/payroll-reports.service';
import { PayrollService } from '../services/payroll.service';
import { PfService } from '../services/pf.service';
import { SalaryService } from '../services/salary.service';

@ApiTags('hr-salary')
@ApiBearerAuth()
@Controller('salary-structures')
export class SalaryStructuresController {
  constructor(private readonly salary: SalaryService) {}

  @Get()
  @RequirePermissions('salary.view')
  async list(
    @Query('activeOnly') activeOnly: string | undefined,
    @Query('search') search: string | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.salary.listStructures(user.schoolId, {
      activeOnly: activeOnly === 'true',
      search,
    });
  }

  @Post('preview')
  @RequirePermissions('salary.view')
  @ApiOperation({
    summary:
      'Live preview for the builder — the same engine the payslip runs through',
  })
  async preview(
    @Body() dto: PreviewStructureDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.salary.preview(dto, user.schoolId);
  }

  @Get(':id')
  @RequirePermissions('salary.view')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.salary.getStructure(id, user.schoolId);
  }

  @Post()
  @RequirePermissions('salary.structure.manage')
  async create(
    @Body() dto: CreateStructureDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.salary.createStructure(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('salary.structure.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStructureDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.salary.updateStructure(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('salary.structure.manage')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.salary.removeStructure(id, user);
  }
}

@ApiTags('hr-payroll')
@ApiBearerAuth()
@Controller('payroll-runs')
export class PayrollRunsController {
  constructor(
    private readonly payroll: PayrollService,
    private readonly posting: PayrollPostingService,
    private readonly reports: PayrollReportsService,
    private readonly exports: PayrollExportService,
    private readonly schools: SchoolsRepository,
  ) {}

  @Get()
  @RequirePermissions('payroll.view')
  async list(
    @Query() query: PayrollQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const { rows, total, page, limit } = await this.payroll.list(
      query,
      user.schoolId,
    );
    return {
      data: rows,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  @Get(':id')
  @RequirePermissions('payroll.view')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.payroll.getDetail(id, user.schoolId);
  }

  @Get(':id/payslips')
  @RequirePermissions('payroll.view')
  async payslips(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return (await this.payroll.getDetail(id, user.schoolId)).payslips;
  }

  @Post()
  @RequirePermissions('payroll.generate')
  @ApiOperation({ summary: 'Open a payroll run for a month' })
  async create(
    @Body() dto: CreatePayrollRunDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.payroll.create(dto, user);
  }

  @Post(':id/generate')
  @RequirePermissions('payroll.generate')
  @ApiOperation({
    summary:
      'Compute every payslip (wipes and rewrites; force needed over unmarked attendance)',
  })
  async generate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GeneratePayrollDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.payroll.generate(id, dto, user);
  }

  @Post(':id/approve')
  @RequirePermissions('payroll.approve')
  @ApiOperation({ summary: 'Freeze the run — payslips stop being editable' })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.payroll.approve(id, user);
  }

  @Post(':id/disburse')
  @RequirePermissions('payroll.disburse')
  @ApiOperation({
    summary:
      'Pay: marks payslips PAID, credits the provident fund and posts the salary voucher',
  })
  async disburse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DisbursePayrollDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.posting.disburse(id, dto, user);
  }

  @Post(':id/cancel')
  @RequirePermissions('payroll.generate')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelPayrollDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.payroll.cancel(id, dto, user);
  }

  @Get(':id/bank-advice.xlsx')
  @RequirePermissions('payroll.export')
  @SkipEnvelope()
  @ApiOperation({ summary: 'The bank advice sheet (held payslips excluded)' })
  async bankAdvice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const [advice, school] = await Promise.all([
      this.reports.bankAdvice(id, user.schoolId),
      this.schools.findByIdOrFail(user.schoolId),
    ]);
    const file = await this.exports.bankAdviceXlsx(
      advice.run,
      advice.rows,
      advice.total,
      school.name,
    );
    return stream(res, file);
  }
}

@ApiTags('hr-payroll')
@ApiBearerAuth()
@Controller('payslips')
export class PayslipsController {
  constructor(
    private readonly payroll: PayrollService,
    private readonly exports: PayrollExportService,
    private readonly schools: SchoolsRepository,
    private readonly config: HrSettingsService,
  ) {}

  @Get(':id')
  @RequirePermissions('payroll.view')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.payroll.getPayslip(id, user.schoolId);
  }

  @Patch(':id')
  @RequirePermissions('payroll.payslip.edit')
  @ApiOperation({
    summary: 'Override a draft payslip with a reason (recomputed, not typed)',
  })
  async edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditPayslipDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.payroll.editPayslip(id, dto, user);
  }

  @Post(':id/hold')
  @RequirePermissions('payroll.payslip.hold')
  async hold(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HoldPayslipDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.payroll.holdPayslip(id, dto, user);
  }

  @Post(':id/release')
  @RequirePermissions('payroll.payslip.hold')
  async release(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.payroll.releasePayslip(id, user);
  }

  @Get(':id/pdf')
  @RequirePermissions('payroll.export')
  @SkipEnvelope()
  async pdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const payslip = await this.payroll.getPayslip(id, user.schoolId);
    const run = await this.payroll.getDetail(
      payslip.payrollRunId,
      user.schoolId,
    );
    const [school, config] = await Promise.all([
      this.schools.findByIdOrFail(user.schoolId),
      this.config.load(user.schoolId),
    ]);
    const file = await this.exports.payslipPdf(payslip, {
      schoolName: school.name,
      schoolAddress: school.address ?? null,
      month: isoDate(run.month).slice(0, 7),
      footer: config.reportFooter,
    });
    return stream(res, file);
  }
}

@ApiTags('hr-payroll')
@ApiBearerAuth()
@Controller('bonus-runs')
export class BonusRunsController {
  constructor(private readonly bonuses: BonusService) {}

  @Get()
  @RequirePermissions('payroll.view')
  async list(@CurrentUser() user: AccessTokenPayload) {
    return this.bonuses.list(user.schoolId);
  }

  @Post()
  @RequirePermissions('bonus.manage')
  async create(
    @Body() dto: CreateBonusDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.bonuses.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('bonus.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBonusDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.bonuses.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('bonus.manage')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.bonuses.remove(id, user);
  }
}

@ApiTags('hr-payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollReportsController {
  constructor(
    private readonly reports: PayrollReportsService,
    private readonly exports: PayrollExportService,
    private readonly pf: PfService,
    private readonly schools: SchoolsRepository,
    private readonly config: HrSettingsService,
  ) {}

  @Get('reports/register')
  @RequirePermissions('payroll.report')
  async register(
    @Query() query: PayrollReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.register(query, user.schoolId);
  }

  @Get('reports/register.xlsx')
  @RequirePermissions('payroll.export')
  @SkipEnvelope()
  async registerXlsx(
    @Query() query: PayrollReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.register(query, user.schoolId);
    return stream(res, await this.exports.registerXlsx(report));
  }

  @Get('reports/register.pdf')
  @RequirePermissions('payroll.export')
  @SkipEnvelope()
  async registerPdf(
    @Query() query: PayrollReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const [report, school, config] = await Promise.all([
      this.reports.register(query, user.schoolId),
      this.schools.findByIdOrFail(user.schoolId),
      this.config.load(user.schoolId),
    ]);
    return stream(
      res,
      await this.exports.registerPdf(report, {
        schoolName: school.name,
        schoolAddress: school.address ?? null,
        footer: config.reportFooter,
      }),
    );
  }

  @Get('reports/pf')
  @RequirePermissions('payroll.report')
  async pfReport(@CurrentUser() user: AccessTokenPayload) {
    return this.reports.pfReport(user.schoolId);
  }

  @Get('reports/pf.xlsx')
  @RequirePermissions('payroll.export')
  @SkipEnvelope()
  async pfXlsx(
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.pfReport(user.schoolId);
    return stream(res, await this.exports.pfXlsx(report.rows));
  }

  @Get('reports/tax')
  @RequirePermissions('payroll.report')
  async taxReport(
    @Query() query: PayrollReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.taxReport(query, user.schoolId);
  }

  @Get('reports/tax.xlsx')
  @RequirePermissions('payroll.export')
  @SkipEnvelope()
  async taxXlsx(
    @Query() query: PayrollReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.taxReport(query, user.schoolId);
    return stream(res, await this.exports.taxXlsx(report.rows, report.window));
  }

  @Get('reports/grades')
  @RequirePermissions('payroll.report')
  async grades(@CurrentUser() user: AccessTokenPayload) {
    return this.reports.gradeDistribution(user.schoolId);
  }

  @Get('reports/grades.xlsx')
  @RequirePermissions('payroll.export')
  @SkipEnvelope()
  async gradesXlsx(
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.gradeDistribution(user.schoolId);
    return stream(res, await this.exports.gradesXlsx(report.rows));
  }

  @Get('reports/ytd')
  @RequirePermissions('payroll.report')
  async ytd(
    @Query() query: PayrollReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.reports.ytd(query, user.schoolId);
  }

  @Get('reports/ytd.xlsx')
  @RequirePermissions('payroll.export')
  @SkipEnvelope()
  async ytdXlsx(
    @Query() query: PayrollReportQueryDto,
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const report = await this.reports.ytd(query, user.schoolId);
    return stream(res, await this.exports.ytdXlsx(report));
  }

  // ── provident fund ──────────────────────────────────────────────────

  @Get('pf/:personType/:personId')
  @RequirePermissions('payroll.report')
  @ApiOperation({ summary: "One employee's provident-fund passbook" })
  async pfStatement(
    @Param('personType') personType: AttendancePersonType,
    @Param('personId', ParseUUIDPipe) personId: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.pf.statement(user.schoolId, personType, personId);
  }

  @Post('pf')
  @RequirePermissions('pf.manage')
  @ApiOperation({
    summary: 'Record a provident-fund withdrawal or adjustment',
  })
  async recordPf(
    @Body() dto: PfEntryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.pf.record(dto, user);
  }
}

function stream(
  res: Response,
  file: { buffer: Buffer; filename: string; contentType: string },
): StreamableFile {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.filename}"`,
  );
  return new StreamableFile(file.buffer);
}
