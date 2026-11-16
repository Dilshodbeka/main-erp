import { describe, expect, it } from 'vitest';
import { searchFaq, supportFaq } from './support-faq';

describe('support FAQ', () => {
  it('ships exactly eight non-empty questions in Latin Uzbek', () => {
    expect(supportFaq).toHaveLength(8);
    expect(new Set(supportFaq.map(item => item.id)).size).toBe(8);
    for (const item of supportFaq) {
      expect(item.question.trim()).not.toBe('');
      expect(item.answer.trim()).not.toBe('');
      expect(`${item.question} ${item.answer}`).not.toMatch(/[А-Яа-яЁё]/);
    }
  });

  it('keeps the approved question wording', () => {
    expect(supportFaq.map(item => item.question)).toEqual([
      'Qanday qilib yangi buyurtma yarataman?',
      'Sexda ishni qanday qabul qilaman?',
      'Materialni omborga qanday qabul qilaman?',
      'Kassaga to‘lovni qanday kiritaman?',
      'Xodimga tizimga kirish huquqini qanday beraman?',
      'Oylik va avans qanday hisoblanadi?',
      'Oflayn rejimda nima ishlaydi?',
      'Muammo bo‘lsa, kimga murojaat qilaman?',
    ]);
  });

  it('searches by case-insensitive substring of question and answer', () => {
    expect(searchFaq('BUYURTMA').map(item => item.id)).toEqual(['new-order']);
    expect(searchFaq('oflayn').map(item => item.id)).toEqual(['offline']);
    expect(searchFaq('  avans  ').map(item => item.id)).toEqual(['salary-advance']);
    expect(searchFaq('')).toBe(supportFaq);
    expect(searchFaq('   ')).toBe(supportFaq);
    expect(searchFaq('zzz')).toEqual([]);
  });

  it('accepts a custom list', () => {
    const items = [{ id: 'one', question: 'Savol', answer: 'Javob' }];
    expect(searchFaq('javob', items)).toEqual(items);
  });
});
