import {
  AdmissionApplicationStatus,
  AdmissionPaymentStatus,
} from '../../../common/constants';
import {
  AdmissionApplicationsService,
  canTransitionManually,
} from './admission-applications.service';

const S = AdmissionApplicationStatus;

describe('canTransitionManually (review pipeline map)', () => {
  it.each([
    [S.SUBMITTED, S.UNDER_REVIEW, true],
    [S.SUBMITTED, S.REJECTED, true],
    [S.PAYMENT_PENDING, S.CANCELLED, true],
    [S.SELECTED, S.CANCELLED, true],
    [S.WAITLISTED, S.CANCELLED, true],
    // Engine-owned targets are never manually settable.
    [S.SUBMITTED, S.SELECTED, false],
    [S.UNDER_REVIEW, S.PASSED, false],
    [S.PASSED, S.ADMITTED, false],
    [S.SELECTED, S.EXPIRED, false],
    [S.ADMITTED, S.CANCELLED, false],
    [S.REJECTED, S.SUBMITTED, false],
  ])('%s → %s = %s', (from, to, expected) => {
    expect(canTransitionManually(from, to)).toBe(expected);
  });
});

describe('AdmissionApplicationsService', () => {
  const applications = {
    findDetail: jest.fn(),
    update: jest.fn(),
    paginateList: jest.fn(),
  };
  const cycles = { findDetail: jest.fn() };
  const merit = { promoteNext: jest.fn() };
  const studentsService = { create: jest.fn(), getDetail: jest.fn() };
  const students = { update: jest.fn() };
  const auditContext = { set: jest.fn() };
  const events = { emit: jest.fn() };
  const actor = { sub: 'admin-1', schoolId: 'school-1' } as never;

  const service = new AdmissionApplicationsService(
    applications as never,
    cycles as never,
    merit as never,
    studentsService as never,
    students as never,
    auditContext as never,
    events as never,
  );

  const baseApp = (overrides: Record<string, unknown> = {}) => ({
    id: 'app-1',
    schoolId: 'school-1',
    cycleId: 'cycle-1',
    classId: 'class-1',
    applicationNo: 'ADM-26-000001',
    firstName: 'Rahim',
    lastName: 'Uddin',
    nameBn: null,
    gender: 'MALE',
    dob: new Date('2015-04-01'),
    religion: 'ISLAM',
    phone: '01712345678',
    photoUrl: null,
    presentAddress: {},
    permanentAddress: {},
    previousSchool: null,
    status: S.SUBMITTED,
    paymentStatus: AdmissionPaymentStatus.UNPAID,
    guardian: {
      name: 'Karim Uddin',
      relation: 'FATHER',
      phone: '01898765432',
    },
    class: { id: 'class-1', name: 'Class 6' },
    cycle: { id: 'cycle-1', name: 'Admission 2027', testRequired: true },
    student: null,
    studentId: null,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    cycles.findDetail.mockResolvedValue({
      classes: [{ classId: 'class-1', applicationFee: 200 }],
    });
  });

  it('rejects manual moves to engine-owned statuses', async () => {
    applications.findDetail.mockResolvedValue(baseApp());
    await expect(
      service.updateStatus('app-1', { status: S.SELECTED }, actor),
    ).rejects.toThrow(/manually/);
  });

  it('auto-promotes the waitlist when a SELECTED application is cancelled', async () => {
    applications.findDetail.mockResolvedValue(baseApp({ status: S.SELECTED }));
    await service.updateStatus(
      'app-1',
      { status: S.CANCELLED, reason: 'Family declined' },
      actor,
    );
    expect(merit.promoteNext).toHaveBeenCalledWith(
      'cycle-1',
      'class-1',
      1,
      actor,
    );
  });

  it('recordPayment moves PAYMENT_PENDING → SUBMITTED and stores the record', async () => {
    applications.findDetail.mockResolvedValue(
      baseApp({ status: S.PAYMENT_PENDING }),
    );
    await service.recordPayment(
      'app-1',
      { method: 'CASH', reference: 'RCPT-9' },
      actor,
    );
    expect(applications.update).toHaveBeenCalledWith(
      'app-1',
      expect.objectContaining({
        paymentStatus: AdmissionPaymentStatus.PAID,
        paymentMethod: 'CASH',
        paymentRef: 'RCPT-9',
        paidAmount: 200, // defaulted from the cycle-class fee
        status: S.SUBMITTED,
      }),
    );
    expect(events.emit).toHaveBeenCalled();
  });

  it('refuses double payment', async () => {
    applications.findDetail.mockResolvedValue(
      baseApp({ paymentStatus: AdmissionPaymentStatus.PAID }),
    );
    await expect(
      service.recordPayment('app-1', { method: 'CASH' }, actor),
    ).rejects.toThrow(/already paid/);
  });

  it('refund requires a prior payment', async () => {
    applications.findDetail.mockResolvedValue(baseApp());
    await expect(
      service.setPaymentStatus(
        'app-1',
        { status: AdmissionPaymentStatus.REFUNDED, reason: 'Cycle void' },
        actor,
      ),
    ).rejects.toThrow(/paid fee/);
  });

  it('admit converts a SELECTED application through StudentsService', async () => {
    applications.findDetail.mockResolvedValue(baseApp({ status: S.SELECTED }));
    studentsService.create.mockResolvedValue({
      student: { id: 'student-1', studentUid: 'HXS-202600001' },
      duplicateWarnings: [],
      warnings: [],
    });

    const result = await service.admit('app-1', actor);

    expect(result.alreadyAdmitted).toBe(false);
    expect(studentsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Rahim',
        admissionClassId: 'class-1',
        guardians: [
          expect.objectContaining({
            name: 'Karim Uddin',
            phone: '01898765432',
            isPrimary: true,
          }),
        ],
      }),
      actor,
    );
    expect(applications.update).toHaveBeenCalledWith(
      'app-1',
      expect.objectContaining({ status: S.ADMITTED, studentId: 'student-1' }),
    );
  });

  it('admit is idempotent for ADMITTED applications', async () => {
    applications.findDetail.mockResolvedValue(
      baseApp({ status: S.ADMITTED, studentId: 'student-1' }),
    );
    studentsService.getDetail.mockResolvedValue({
      id: 'student-1',
      studentUid: 'HXS-202600001',
    });

    const result = await service.admit('app-1', actor);
    expect(result.alreadyAdmitted).toBe(true);
    expect(studentsService.create).not.toHaveBeenCalled();
    expect(applications.update).not.toHaveBeenCalled();
  });

  it('admit refuses non-SELECTED applications', async () => {
    applications.findDetail.mockResolvedValue(
      baseApp({ status: S.WAITLISTED }),
    );
    await expect(service.admit('app-1', actor)).rejects.toThrow(
      /Only SELECTED/,
    );
  });
});
