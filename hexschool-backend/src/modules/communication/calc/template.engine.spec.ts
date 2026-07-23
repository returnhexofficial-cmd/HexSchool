import {
  extractVariables,
  renderTemplate,
  validateTemplate,
} from './template.engine';

describe('template engine', () => {
  describe('extractVariables', () => {
    it('finds distinct variables in first-seen order', () => {
      expect(
        extractVariables('{{name}} scored {{gpa}} — congrats {{name}}!'),
      ).toEqual(['name', 'gpa']);
    });

    it('tolerates whitespace inside the braces', () => {
      expect(extractVariables('Hi {{  name  }}')).toEqual(['name']);
    });

    it('returns nothing for a plain body', () => {
      expect(extractVariables('No variables here.')).toEqual([]);
    });
  });

  describe('renderTemplate', () => {
    it('substitutes provided variables', () => {
      expect(
        renderTemplate('{{name}}: GPA {{gpa}} ({{grade}})', {
          name: 'Karim',
          gpa: 5,
          grade: 'A+',
        }),
      ).toBe('Karim: GPA 5 (A+)');
    });

    it('renders a missing variable as empty, never as the raw token', () => {
      expect(renderTemplate('Hi {{name}}{{suffix}}', { name: 'Rahim' })).toBe(
        'Hi Rahim',
      );
    });

    it('coerces numbers and booleans', () => {
      expect(renderTemplate('{{n}}/{{ok}}', { n: 42, ok: true })).toBe(
        '42/true',
      );
    });

    it('leaves a body with no variables untouched', () => {
      expect(renderTemplate('Plain text', { x: 1 })).toBe('Plain text');
    });
  });

  describe('validateTemplate', () => {
    it('accepts a body whose variables are all allowed', () => {
      const res = validateTemplate('{{name}} {{gpa}}', ['name', 'gpa', 'exam']);
      expect(res.ok).toBe(true);
      expect(res.unknown).toEqual([]);
      expect(res.unused).toEqual(['exam']);
    });

    it('flags an unknown (typo) variable', () => {
      const res = validateTemplate('{{studnet_name}}', ['student_name']);
      expect(res.ok).toBe(false);
      expect(res.unknown).toEqual(['studnet_name']);
    });
  });
});
