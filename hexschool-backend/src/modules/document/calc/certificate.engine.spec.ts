import {
  canIssue,
  canReissue,
  canRevoke,
  verificationMessage,
  verificationOutcome,
  type IssueCandidate,
} from './certificate.engine';

const draft = (over: Partial<IssueCandidate> = {}): IssueCandidate => ({
  status: 'DRAFT',
  type: 'TRANSFER',
  existingIssued: 0,
  studentDeleted: false,
  ...over,
});

describe('certificate.engine — canIssue', () => {
  it('allows a clean draft', () => {
    expect(canIssue(draft())).toMatchObject({ allowed: true, tier: null });
  });

  it('refuses an already-issued certificate structurally', () => {
    const verdict = canIssue(draft({ status: 'ISSUED' }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.tier).toBe('STRUCTURAL');
    expect(verdict.reason).toContain('already been issued');
  });

  it('refuses a revoked one and points at the correction flow', () => {
    const verdict = canIssue(draft({ status: 'REVOKED' }));
    expect(verdict.tier).toBe('STRUCTURAL');
    expect(verdict.reason).toContain('correction');
  });

  it('refuses when there is nobody left to certify', () => {
    expect(canIssue(draft({ studentDeleted: true }))).toMatchObject({
      allowed: false,
      tier: 'STRUCTURAL',
    });
  });

  it('refuses a template of the wrong type', () => {
    const verdict = canIssue(draft({ templateType: 'CHARACTER' }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('CHARACTER layout');
  });

  it('allows a template of the right type', () => {
    expect(canIssue(draft({ templateType: 'TRANSFER' })).allowed).toBe(true);
  });

  it('warns — but does not refuse — on a retired template', () => {
    const verdict = canIssue(
      draft({ templateType: 'TRANSFER', templateActive: false }),
    );
    expect(verdict.allowed).toBe(true);
    expect(verdict.warnings[0]).toContain('switched off');
  });

  it('warns rather than refusing when the student already holds one', () => {
    // Refusing would push the office into deleting the first record to
    // get past the check — which destroys the register this module keeps.
    const verdict = canIssue(draft({ existingIssued: 1 }));
    expect(verdict.allowed).toBe(true);
    expect(verdict.warnings[0]).toContain('already holds 1 live TRANSFER');
    expect(verdict.warnings[0]).toContain('DUPLICATE');
  });
});

describe('certificate.engine — canRevoke', () => {
  it('allows revoking an issued certificate', () => {
    expect(canRevoke('ISSUED').allowed).toBe(true);
  });

  it('refuses a draft — nothing left the building, so delete it', () => {
    const verdict = canRevoke('DRAFT');
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('delete it');
  });

  it('refuses a second revocation', () => {
    expect(canRevoke('REVOKED').allowed).toBe(false);
  });
});

describe('certificate.engine — canReissue', () => {
  describe('DUPLICATE', () => {
    it('needs the original to still be valid', () => {
      expect(
        canReissue({ kind: 'DUPLICATE', originalStatus: 'ISSUED' }).allowed,
      ).toBe(true);
    });

    it('refuses to reprint a revoked certificate under a fresh number', () => {
      const verdict = canReissue({
        kind: 'DUPLICATE',
        originalStatus: 'REVOKED',
      });
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toContain('still valid');
    });

    it('refuses to duplicate a draft', () => {
      expect(
        canReissue({ kind: 'DUPLICATE', originalStatus: 'DRAFT' }).allowed,
      ).toBe(false);
    });

    it('says the original stays valid — the family may yet find it', () => {
      const verdict = canReissue({
        kind: 'DUPLICATE',
        originalStatus: 'ISSUED',
      });
      expect(verdict.warnings[0]).toContain('original remains valid');
    });
  });

  describe('CORRECTION', () => {
    it('needs the original revoked first', () => {
      expect(
        canReissue({ kind: 'CORRECTION', originalStatus: 'REVOKED' }).allowed,
      ).toBe(true);
    });

    it('refuses while the original is still live — both would verify VALID', () => {
      const verdict = canReissue({
        kind: 'CORRECTION',
        originalStatus: 'ISSUED',
      });
      expect(verdict.allowed).toBe(false);
      expect(verdict.tier).toBe('POLICY');
      expect(verdict.reason).toContain('both would verify VALID');
    });
  });

  it('gives the two kinds opposite preconditions', () => {
    const dupOnIssued = canReissue({
      kind: 'DUPLICATE',
      originalStatus: 'ISSUED',
    }).allowed;
    const corrOnIssued = canReissue({
      kind: 'CORRECTION',
      originalStatus: 'ISSUED',
    }).allowed;
    expect(dupOnIssued).toBe(true);
    expect(corrOnIssued).toBe(false);
  });
});

describe('certificate.engine — verification', () => {
  it('verifies an issued certificate VALID', () => {
    expect(
      verificationOutcome({ status: 'ISSUED', issueKind: 'ORIGINAL' }),
    ).toBe('VALID');
  });

  it('reports a revoked certificate as REVOKED, not as missing', () => {
    // Saying "no such certificate" would make a cancelled document and a
    // forgery look identical to whoever is checking.
    expect(
      verificationOutcome({ status: 'REVOKED', issueKind: 'ORIGINAL' }),
    ).toBe('REVOKED');
  });

  it('gives an unknown code and a DRAFT the same NOT_FOUND answer', () => {
    expect(verificationOutcome(null)).toBe('NOT_FOUND');
    expect(
      verificationOutcome({ status: 'DRAFT', issueKind: 'ORIGINAL' }),
    ).toBe('NOT_FOUND');
  });

  it('says a duplicate is genuine and that both copies are valid', () => {
    const message = verificationMessage('VALID', {
      status: 'ISSUED',
      issueKind: 'DUPLICATE',
    });
    expect(message).toContain('duplicate');
    expect(message).toContain('both are valid');
  });

  it('prints the school’s own reason for revoking', () => {
    const message = verificationMessage('REVOKED', {
      status: 'REVOKED',
      issueKind: 'ORIGINAL',
      revokedReason: 'Name corrected and reissued as TC-26-0031',
    });
    expect(message).toContain('TC-26-0031');
  });

  it('still answers when a revocation carries no reason', () => {
    expect(
      verificationMessage('REVOKED', {
        status: 'REVOKED',
        issueKind: 'ORIGINAL',
      }),
    ).toContain('has since been revoked');
  });

  it('never confirms existence in the NOT_FOUND message', () => {
    const message = verificationMessage('NOT_FOUND', null);
    expect(message).toContain('No certificate matches this code');
  });
});
