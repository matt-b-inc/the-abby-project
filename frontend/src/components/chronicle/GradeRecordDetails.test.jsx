import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import GradeRecordDetails from './GradeRecordDetails';

describe('GradeRecordDetails', () => {
  it('names the subject, assessment, and native result on a memory surface', () => {
    render(<GradeRecordDetails entry={{ metadata: { grade: {
      subject: 'Math', assessment: 'Fractions quiz', grade_format: 'points', score: '8', possible: '10',
    } } }} />);
    expect(screen.getByText('Math')).toBeInTheDocument();
    expect(screen.getByText('Fractions quiz')).toBeInTheDocument();
    expect(screen.getByText('8 / 10 points')).toBeInTheDocument();
    expect(screen.queryByText(/80%|GPA/)).toBeNull();
  });
});
