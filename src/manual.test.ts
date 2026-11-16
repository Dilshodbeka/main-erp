import { describe, expect, it } from 'vitest';
import { manualTopics } from './manual';

describe('manual topics', () => {
  it('covers painting, customer facades and LKM norms', () => {
    expect(manualTopics.map(topic => topic.id)).toEqual(['boyash', 'fasadlar', 'lkm']);
  });

  it('gives every topic a summary and step-by-step sections', () => {
    for (const topic of manualTopics) {
      expect(topic.title.length, topic.id).toBeGreaterThan(3);
      expect(topic.summary.length, topic.id).toBeGreaterThan(20);
      expect(topic.sections.length, topic.id).toBeGreaterThanOrEqual(3);
      for (const section of topic.sections) {
        expect(section.title.length, topic.id).toBeGreaterThan(3);
        expect(section.body.length, topic.id).toBeGreaterThan(20);
        expect(section.steps?.length ?? 0, `${topic.id}/${section.title}`).toBeGreaterThan(0);
      }
    }
  });

  it('points to the real screen labels and guards', () => {
    const text = JSON.stringify(manualTopics);
    for (const label of [
      'Sexga ishga tushirish', 'Materiallarni berish', 'Mijozdan qabul', 'mijozniki',
      '1 m² uchun norma', '06.01', 'Alohida xizmat', 'm²',
    ]) {
      expect(text, label).toContain(label);
    }
  });
});
