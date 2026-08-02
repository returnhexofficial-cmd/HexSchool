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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  AssetQueryDto,
  AssignAssetDto,
  CancelPurchaseDto,
  CreateAdjustmentDto,
  CreateIssueDto,
  DisposeAssetDto,
  HolderSearchQueryDto,
  IssueQueryDto,
  ItemQueryDto,
  PurchaseQueryDto,
  ReceivePurchaseDto,
  RepairAssetDto,
  ReturnIssueDto,
  SupplierQueryDto,
  UpsertAssetDto,
  UpsertCategoryDto,
  UpsertItemDto,
  UpsertPurchaseDto,
  UpsertSupplierDto,
} from '../dto';
import { InventoryDirectoryRepository } from '../repositories/inventory-directory.repository';
import { AssetsService } from '../services/assets.service';
import { CatalogService } from '../services/catalog.service';
import { PurchasesService } from '../services/purchases.service';
import { StockIssuesService } from '../services/stock-issues.service';
import { StockService } from '../services/stock.service';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly purchases: PurchasesService,
    private readonly issues: StockIssuesService,
    private readonly assets: AssetsService,
    private readonly stock: StockService,
    private readonly directory: InventoryDirectoryRepository,
  ) {}

  // ── suppliers ───────────────────────────────────────────────────────

  @Get('suppliers')
  @RequirePermissions('inventory.view')
  listSuppliers(
    @Query() query: SupplierQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.listSuppliers(query, user);
  }

  @Get('suppliers/:id')
  @RequirePermissions('inventory.view')
  getSupplier(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.getSupplier(id, user);
  }

  @Post('suppliers')
  @RequirePermissions('inventory.catalog.manage')
  createSupplier(
    @Body() dto: UpsertSupplierDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.createSupplier(dto, user);
  }

  @Patch('suppliers/:id')
  @RequirePermissions('inventory.catalog.manage')
  updateSupplier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertSupplierDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.updateSupplier(id, dto, user);
  }

  @Delete('suppliers/:id')
  @RequirePermissions('inventory.catalog.manage')
  @HttpCode(204)
  async removeSupplier(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.catalog.removeSupplier(id, user);
  }

  // ── categories ──────────────────────────────────────────────────────

  @Get('categories')
  @RequirePermissions('inventory.view')
  @ApiOperation({ summary: 'The whole category tree with item counts' })
  categoryTree(@CurrentUser() user: AccessTokenPayload) {
    return this.catalog.categoryTree(user.schoolId);
  }

  @Post('categories')
  @RequirePermissions('inventory.catalog.manage')
  createCategory(
    @Body() dto: UpsertCategoryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.createCategory(dto, user);
  }

  @Patch('categories/:id')
  @RequirePermissions('inventory.catalog.manage')
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertCategoryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.updateCategory(id, dto, user);
  }

  @Delete('categories/:id')
  @RequirePermissions('inventory.catalog.manage')
  @HttpCode(204)
  async removeCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.catalog.removeCategory(id, user);
  }

  // ── items ───────────────────────────────────────────────────────────

  @Get('items')
  @RequirePermissions('inventory.view')
  listItems(
    @Query() query: ItemQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.listItems(query, user);
  }

  @Get('items/:id')
  @RequirePermissions('inventory.view')
  getItem(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.getItem(id, user);
  }

  @Post('items')
  @RequirePermissions('inventory.catalog.manage')
  createItem(
    @Body() dto: UpsertItemDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.createItem(dto, user);
  }

  @Patch('items/:id')
  @RequirePermissions('inventory.catalog.manage')
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertItemDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.catalog.updateItem(id, dto, user);
  }

  @Delete('items/:id')
  @RequirePermissions('inventory.catalog.manage')
  @HttpCode(204)
  async removeItem(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.catalog.removeItem(id, user);
  }

  @Get('items/:id/ledger')
  @RequirePermissions('inventory.view')
  @ApiOperation({ summary: "One item's movements with the running balance" })
  itemHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.stock.history(user.schoolId, id);
  }

  // ── purchases ───────────────────────────────────────────────────────

  @Get('purchases')
  @RequirePermissions('inventory.view')
  listPurchases(
    @Query() query: PurchaseQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.purchases.list(query, user);
  }

  @Get('purchases/:id')
  @RequirePermissions('inventory.view')
  getPurchase(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.purchases.get(id, user);
  }

  @Post('purchases')
  @RequirePermissions('inventory.purchase.manage')
  createPurchase(
    @Body() dto: UpsertPurchaseDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.purchases.create(dto, user);
  }

  @Patch('purchases/:id')
  @RequirePermissions('inventory.purchase.manage')
  updatePurchase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertPurchaseDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.purchases.update(id, dto, user);
  }

  @Delete('purchases/:id')
  @RequirePermissions('inventory.purchase.manage')
  @HttpCode(204)
  async removePurchase(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    await this.purchases.remove(id, user);
  }

  @Post('purchases/:id/receive')
  @RequirePermissions('inventory.purchase.receive')
  @ApiOperation({
    summary:
      'Receive a delivery: stock in, asset units generated, voucher posted',
  })
  receivePurchase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceivePurchaseDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.purchases.receive(id, dto, user);
  }

  // Deliberately a DIFFERENT permission from `receive`. Cancelling a
  // received delivery reverses stock the school may already have issued —
  // the M20 `voucher.cancel` separation, in a second ledger.
  @Post('purchases/:id/cancel')
  @RequirePermissions('inventory.purchase.cancel')
  cancelPurchase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelPurchaseDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.purchases.cancel(id, dto, user);
  }

  // ── issues ──────────────────────────────────────────────────────────

  @Get('issues')
  @RequirePermissions('inventory.view')
  listIssues(
    @Query() query: IssueQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.issues.list(query, user);
  }

  @Get('issues/:id')
  @RequirePermissions('inventory.view')
  getIssue(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.issues.get(id, user);
  }

  @Post('issues/preview')
  @RequirePermissions('inventory.issue')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'The same verdict the issue endpoint will reach, before committing',
  })
  previewIssue(
    @Body() dto: CreateIssueDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.issues.preview(dto, user);
  }

  @Post('issues')
  @RequirePermissions('inventory.issue')
  createIssue(
    @Body() dto: CreateIssueDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.issues.create(dto, user);
  }

  @Post('issues/:id/return')
  @RequirePermissions('inventory.issue')
  returnIssue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnIssueDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.issues.processReturn(id, dto, user);
  }

  @Get('issuable-items')
  @RequirePermissions('inventory.view')
  @ApiOperation({ summary: "The desk's picker: consumables with balances" })
  issuableItems(
    @Query() query: HolderSearchQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.issues.issuableItems(user.schoolId, query.search);
  }

  // ── adjustments (roadmap §4 + §8's count-sheet wizard) ───────────────

  @Post('adjustments')
  @RequirePermissions('inventory.adjust')
  @ApiOperation({
    summary: 'Correct balances from a physical count — reason mandatory',
  })
  adjust(
    @Body() dto: CreateAdjustmentDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.issues.adjust(dto, user);
  }

  // ── assets ──────────────────────────────────────────────────────────

  @Get('assets')
  @RequirePermissions('inventory.view')
  listAssets(
    @Query() query: AssetQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assets.list(query, user);
  }

  @Get('assets/:id')
  @RequirePermissions('inventory.view')
  getAsset(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assets.get(id, user);
  }

  @Post('assets')
  @RequirePermissions('inventory.asset.manage')
  createAsset(
    @Body() dto: UpsertAssetDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assets.create(dto, user);
  }

  @Patch('assets/:id')
  @RequirePermissions('inventory.asset.manage')
  updateAsset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertAssetDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assets.update(id, dto, user);
  }

  // Assign and transfer are one endpoint, because a transfer IS an
  // assignment to somebody else — see `canTransition`.
  @Post('assets/:id/assign')
  @RequirePermissions('inventory.asset.manage')
  assignAsset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignAssetDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assets.assign(id, dto, user);
  }

  @Post('assets/:id/transfer')
  @RequirePermissions('inventory.asset.manage')
  transferAsset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignAssetDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assets.assign(id, dto, user);
  }

  @Post('assets/:id/return')
  @RequirePermissions('inventory.asset.manage')
  returnAsset(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assets.returnToStore(id, user);
  }

  @Post('assets/:id/repair')
  @RequirePermissions('inventory.asset.manage')
  repairAsset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RepairAssetDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assets.sendForRepair(id, dto, user);
  }

  @Post('assets/:id/repair-complete')
  @RequirePermissions('inventory.asset.manage')
  completeRepair(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RepairAssetDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assets.completeRepair(id, dto, user);
  }

  // Roadmap §6: "disposal needs approval permission" — a separate code
  // the Office Staff baseline deliberately lacks.
  @Post('assets/:id/dispose')
  @RequirePermissions('inventory.asset.dispose')
  disposeAsset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DisposeAssetDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.assets.dispose(id, dto, user);
  }

  // ── pickers ─────────────────────────────────────────────────────────

  @Get('holders')
  @RequirePermissions('inventory.view')
  @ApiOperation({
    summary: 'Departments and employees a slip or an asset can be given to',
  })
  async holders(
    @Query() query: HolderSearchQueryDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    const [departments, people] = await Promise.all([
      this.directory.departments(user.schoolId),
      this.directory.searchHolders(user.schoolId, query.search),
    ]);
    return { departments, people };
  }
}
