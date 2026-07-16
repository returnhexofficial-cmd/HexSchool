import { NCTB_GRADES } from '../seed/school.seeder';
import {
  findCoverageIssues,
  findOverlapIssues,
  GradeBand,
} from './grade-range.validator';

const band = (grade: string, minMark: number, maxMark: number): GradeBand => ({
  grade,
  minMark,
  maxMark,
});

describe('grade range validators', () => {
  it('the NCTB seed scale is overlap-free and fully covering (golden)', () => {
    expect(findOverlapIssues([...NCTB_GRADES])).toEqual([]);
    expect(findCoverageIssues([...NCTB_GRADES])).toEqual([]);
  });

  it('detects overlapping bands', () => {
    const issues = findOverlapIssues([band('A', 60, 80), band('B', 75, 100)]);
    expect(issues.map((i) => i.code)).toContain('OVERLAP');
  });

  it('adjacent touching bands (79|80) do not overlap', () => {
    expect(findOverlapIssues([band('A', 80, 100), band('B', 60, 79)])).toEqual(
      [],
    );
  });

  it('detects inverted and out-of-bounds bands', () => {
    expect(findOverlapIssues([band('X', 50, 40)]).map((i) => i.code)).toContain(
      'INVERTED',
    );
    expect(
      findOverlapIssues([band('X', 90, 110)]).map((i) => i.code),
    ).toContain('OUT_OF_BOUNDS');
  });

  it('detects gaps at the start, middle, and end', () => {
    const issues = findCoverageIssues([band('A', 50, 79), band('B', 10, 40)]);
    const messages = issues.map((i) => i.message).join(' | ');
    expect(messages).toContain('0–9');
    expect(messages).toContain('41–49');
    expect(messages).toContain('80–100');
  });

  it('an empty scale can never be default', () => {
    expect(findCoverageIssues([]).map((i) => i.code)).toEqual(['EMPTY']);
  });
});
