import { SequenceService } from './sequence.service';

describe('SequenceService', () => {
  const repo = { nextValue: jest.fn() };
  const service = new SequenceService(repo as never);

  beforeEach(() => jest.clearAllMocks());

  describe('render', () => {
    const date = new Date('2026-07-17T00:00:00Z');

    it('renders the default employee-ID pattern', () => {
      expect(
        service.render('{SCHOOL_CODE}-S-{YY}{SEQ4}', {
          schoolCode: 'HXS',
          seq: 7,
          date,
        }),
      ).toBe('HXS-S-260007');
    });

    it('supports year/month tokens and arbitrary pad widths', () => {
      expect(
        service.render('INV-{YYYY}{MM}-{SEQ6}', {
          schoolCode: 'HXS',
          seq: 123,
          date,
        }),
      ).toBe('INV-202607-000123');
    });

    it('keeps every digit when the sequence overflows its pad width', () => {
      expect(
        service.render('{SEQ2}', { schoolCode: 'X', seq: 12345, date }),
      ).toBe('12345');
    });
  });

  it('nextDocumentNumber claims the counter and renders it', async () => {
    repo.nextValue.mockResolvedValue(42);
    const tx = { marker: true };

    const result = await service.nextDocumentNumber({
      schoolId: 'school-1',
      counterKey: 'staff:26',
      pattern: '{SCHOOL_CODE}-S-{YY}{SEQ4}',
      schoolCode: 'HXS',
      date: new Date('2026-01-05T00:00:00Z'),
      tx: tx as never,
    });

    expect(result).toBe('HXS-S-260042');
    expect(repo.nextValue).toHaveBeenCalledWith('school-1', 'staff:26', tx);
  });
});
