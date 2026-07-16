import { BadRequestException, ConflictException } from '@nestjs/common';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { NCTB_GRADES } from '../seed/school.seeder';
import { GradingSystemsService } from './grading-systems.service';

describe('GradingSystemsService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };

  const nctbPoints = NCTB_GRADES.map((g) => ({
    ...g,
    point: { toString: () => g.point.toFixed(2) },
  }));

  const defaultSystem = {
    id: 'sys-default',
    schoolId: 'school-1',
    name: 'NCTB Standard',
    isDefault: true,
    gradePoints: nctbPoints,
  };
  const customSystem = {
    ...defaultSystem,
    id: 'sys-custom',
    name: 'Junior Scale',
    isDefault: false,
  };

  let repo: Record<string, jest.Mock>;
  let auditContext: { set: jest.Mock };
  let service: GradingSystemsService;

  beforeEach(() => {
    repo = {
      findAllWithPoints: jest.fn(),
      findByIdWithPoints: jest.fn(),
      createWithPoints: jest
        .fn()
        .mockImplementation((data: object) =>
          Promise.resolve({ ...customSystem, ...data, gradePoints: [] }),
        ),
      updateWithPoints: jest.fn().mockResolvedValue(customSystem),
      setDefault: jest.fn(),
      softDelete: jest.fn(),
    };
    auditContext = { set: jest.fn() };
    service = new GradingSystemsService(repo as never, auditContext as never);
  });

  it('rejects overlapping bands on any save', async () => {
    await expect(
      service.create(
        {
          name: 'Broken',
          gradePoints: [
            { grade: 'A', point: 5, minMark: 60, maxMark: 100 },
            { grade: 'B', point: 4, minMark: 50, maxMark: 60 },
          ],
        },
        actor,
      ),
    ).rejects.toThrow(/overlaps/);
  });

  it('rejects duplicate grade labels', async () => {
    await expect(
      service.create(
        {
          name: 'Broken',
          gradePoints: [
            { grade: 'A', point: 5, minMark: 80, maxMark: 100 },
            { grade: 'A', point: 4, minMark: 0, maxMark: 79 },
          ],
        },
        actor,
      ),
    ).rejects.toThrow(/unique/);
  });

  it('allows a NON-default system with gaps, but not as default', async () => {
    const gappy = [{ grade: 'A', point: 5, minMark: 50, maxMark: 100 }];
    await expect(
      service.create({ name: 'Partial', gradePoints: gappy }, actor),
    ).resolves.toBeDefined();
    await expect(
      service.create(
        { name: 'Partial', isDefault: true, gradePoints: gappy },
        actor,
      ),
    ).rejects.toThrow(/not covered/);
  });

  it('creating a covering default uses the transactional switch', async () => {
    await service.create(
      {
        name: 'Full',
        isDefault: true,
        gradePoints: NCTB_GRADES.map((g) => ({ ...g })),
      },
      actor,
    );
    expect(repo.setDefault).toHaveBeenCalled();
    // Never inserted as default directly — the switch demotes the old one.
    expect(repo.createWithPoints).toHaveBeenCalledWith(
      expect.objectContaining({ isDefault: false }),
      expect.anything(),
    );
  });

  it('promoting an existing gappy system to default is rejected', async () => {
    repo.findByIdWithPoints.mockResolvedValue({
      ...customSystem,
      gradePoints: [
        {
          grade: 'A',
          point: { toString: () => '5.00' },
          minMark: 50,
          maxMark: 100,
        },
      ],
    });
    await expect(
      service.update(customSystem.id, { isDefault: true }, actor),
    ).rejects.toThrow(/not covered/);
  });

  it('the default cannot be demoted directly', async () => {
    repo.findByIdWithPoints.mockResolvedValue(defaultSystem);
    await expect(
      service.update(defaultSystem.id, { isDefault: false }, actor),
    ).rejects.toThrow(BadRequestException);
  });

  it('the default cannot be deleted', async () => {
    repo.findByIdWithPoints.mockResolvedValue(defaultSystem);
    await expect(service.remove(defaultSystem.id, actor)).rejects.toThrow(
      ConflictException,
    );
  });

  it('deleting a non-default soft-deletes and records the audit snapshot', async () => {
    repo.findByIdWithPoints.mockResolvedValue(customSystem);
    await service.remove(customSystem.id, actor);
    expect(repo.softDelete).toHaveBeenCalledWith(customSystem.id);
    expect(auditContext.set).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'GradingSystem' }),
    );
  });
});
