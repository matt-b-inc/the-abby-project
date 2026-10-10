import { describe, expect, it } from 'vitest';
import { gradeResultText } from './gradeDisplay';

describe('grade result display', () => {
  it('retains the recorded percentage precision', () => {
    expect(gradeResultText({ metadata: { grade: { grade_format: 'percentage', score: '87.50' } } }))
      .toBe('87.50%');
  });

  it('retains points including a zero score without calculating a percentage', () => {
    expect(gradeResultText({ metadata: { grade: { grade_format: 'points', score: '0', possible: '12.5' } } }))
      .toBe('0 / 12.5 points');
  });

  it('displays the recorded letter without inventing a numeric equivalent', () => {
    expect(gradeResultText({ metadata: { grade: { grade_format: 'letter', letter: 'B+' } } }))
      .toBe('B+');
  });

  it('does not expose missing results as undefined or assume a grading scale', () => {
    expect(gradeResultText({})).toBe('Result unavailable');
    expect(gradeResultText({ metadata: { grade: { grade_format: 'points', score: '5' } } }))
      .toBe('Result unavailable');
  });
});
