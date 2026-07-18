import { AdmissionApplicationStatus } from '../../../common/constants';
import { AdmissionExpiryJob } from './admission-expiry.job';

describe('AdmissionExpiryJob', () => {
  const applications = {
    findExpiredSelections: jest.fn(),
    update: jest.fn(),
  };
  const merit = { promoteNext: jest.fn().mockResolvedValue([]) };
  const events = { emit: jest.fn() };

  const job = new AdmissionExpiryJob(
    applications as never,
    merit as never,
    events as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('does nothing when no selection is overdue', async () => {
    applications.findExpiredSelections.mockResolvedValue([]);
    await expect(job.expireOverdueSelections()).resolves.toBe(0);
    expect(applications.update).not.toHaveBeenCalled();
    expect(merit.promoteNext).not.toHaveBeenCalled();
  });

  it('expires overdue selections and promotes one per freed seat', async () => {
    applications.findExpiredSelections.mockResolvedValue([
      {
        id: 'a1',
        applicationNo: 'ADM-1',
        schoolId: 's1',
        phone: '01711111111',
        cycleId: 'c1',
        classId: 'k1',
      },
      {
        id: 'a2',
        applicationNo: 'ADM-2',
        schoolId: 's1',
        phone: '01722222222',
        cycleId: 'c1',
        classId: 'k1',
      },
      {
        id: 'a3',
        applicationNo: 'ADM-3',
        schoolId: 's1',
        phone: '01733333333',
        cycleId: 'c1',
        classId: 'k2',
      },
    ]);

    await expect(job.expireOverdueSelections()).resolves.toBe(3);

    expect(applications.update).toHaveBeenCalledTimes(3);
    expect(applications.update).toHaveBeenCalledWith('a1', {
      status: AdmissionApplicationStatus.EXPIRED,
    });
    // Freed seats grouped per (cycle, class).
    expect(merit.promoteNext).toHaveBeenCalledWith('c1', 'k1', 2, null);
    expect(merit.promoteNext).toHaveBeenCalledWith('c1', 'k2', 1, null);
    expect(events.emit).toHaveBeenCalledTimes(3);
  });
});
