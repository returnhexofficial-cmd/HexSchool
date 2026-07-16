import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsGroup, UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SECRET_MASK } from '../settings/settings.registry';
import { SettingsCryptoService } from './settings-crypto.service';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };
  const crypto = new SettingsCryptoService({
    getOrThrow: () => 'k'.repeat(32),
  } as unknown as ConfigService);

  let rows: Array<{ key: string; value: unknown }>;
  let repo: {
    findGroup: jest.Mock;
    upsertMany: jest.Mock;
    findByKeys: jest.Mock;
  };
  let cache: { getJson: jest.Mock; setJson: jest.Mock; del: jest.Mock };
  let auditContext: { set: jest.Mock };
  let service: SettingsService;

  beforeEach(() => {
    rows = [];
    repo = {
      findGroup: jest.fn().mockImplementation(() => Promise.resolve(rows)),
      findByKeys: jest.fn(),
      upsertMany: jest.fn().mockResolvedValue(undefined),
    };
    cache = {
      getJson: jest.fn().mockResolvedValue(null),
      setJson: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    auditContext = { set: jest.fn() };
    service = new SettingsService(
      repo as never,
      crypto,
      cache as never,
      auditContext as never,
    );
  });

  it('getGroup merges registry defaults for unset keys', async () => {
    const views = await service.getGroup('school-1', SettingsGroup.general);
    const tz = views.find((v) => v.key === 'general.timezone');
    expect(tz?.value).toBe('Asia/Dhaka');
  });

  it('getGroup masks stored secrets and never leaks ciphertext', async () => {
    rows = [
      { key: 'email.smtp_pass', value: crypto.encrypt('hunter2') },
      { key: 'email.smtp_host', value: 'mail.school.bd' },
    ];
    const views = await service.getGroup('school-1', SettingsGroup.email);
    expect(views.find((v) => v.key === 'email.smtp_pass')?.value).toBe(
      SECRET_MASK,
    );
    expect(views.find((v) => v.key === 'email.smtp_host')?.value).toBe(
      'mail.school.bd',
    );
  });

  it('getValue decrypts secrets for internal consumers', async () => {
    rows = [{ key: 'email.smtp_pass', value: crypto.encrypt('hunter2') }];
    await expect(
      service.getValue<string>('school-1', 'email.smtp_pass'),
    ).resolves.toBe('hunter2');
  });

  it('getValue falls back to the registry default when unset', async () => {
    await expect(
      service.getValue<number>('school-1', 'email.smtp_port'),
    ).resolves.toBe(587);
  });

  it('rejects unknown keys and keys from another group', async () => {
    await expect(
      service.updateGroup('school-1', SettingsGroup.email, { bogus: 1 }, actor),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateGroup(
        'school-1',
        SettingsGroup.email,
        { 'sms.api_key': 'x' },
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects type mismatches', async () => {
    await expect(
      service.updateGroup(
        'school-1',
        SettingsGroup.email,
        { 'email.smtp_port': 'not-a-number' },
        actor,
      ),
    ).rejects.toThrow(/must be a number/);
  });

  it('encrypts secrets before persisting and busts the group cache', async () => {
    await service.updateGroup(
      'school-1',
      SettingsGroup.email,
      { 'email.smtp_pass': 'hunter2' },
      actor,
    );
    const [, , entries] = repo.upsertMany.mock.calls[0] as [
      string,
      string,
      Array<{ key: string; value: string }>,
      string,
    ];
    expect(entries[0].key).toBe('email.smtp_pass');
    expect(entries[0].value).not.toBe('hunter2');
    expect(crypto.decrypt(entries[0].value)).toBe('hunter2');
    expect(cache.del).toHaveBeenCalledWith('settings:school-1:email');
  });

  it('SECRET_MASK sentinel keeps the stored secret untouched', async () => {
    rows = [{ key: 'email.smtp_pass', value: crypto.encrypt('hunter2') }];
    await service.updateGroup(
      'school-1',
      SettingsGroup.email,
      { 'email.smtp_pass': SECRET_MASK, 'email.smtp_host': 'mail.new.bd' },
      actor,
    );
    const [, , entries] = repo.upsertMany.mock.calls[0] as [
      string,
      string,
      Array<{ key: string }>,
      string,
    ];
    expect(entries.map((e) => e.key)).toEqual(['email.smtp_host']);
  });

  it('audit diff redacts secret values on both sides', async () => {
    await service.updateGroup(
      'school-1',
      SettingsGroup.email,
      { 'email.smtp_pass': 'hunter2' },
      actor,
    );
    const [draft] = auditContext.set.mock.calls[0] as [
      {
        oldValues: Record<string, unknown>;
        newValues: Record<string, unknown>;
      },
    ];
    expect(draft.newValues['email.smtp_pass']).toBe('[REDACTED]');
    expect(draft.oldValues['email.smtp_pass']).toBe('[REDACTED]');
  });
});
