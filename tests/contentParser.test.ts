import { describe, it, expect } from 'vitest';
import {
  getNewContent,
  isTherapistResponse,
  formatResponse,
  THERAPIST_PREFIX
} from '../src/contentParser';

describe('contentParser', () => {
  describe('getNewContent', () => {
    it('returns all content when no therapist response exists', () => {
      const content = 'Had a rough day at work today.';
      expect(getNewContent(content)).toBe('Had a rough day at work today.');
    });

    it('returns empty string when content is empty', () => {
      expect(getNewContent('')).toBe('');
    });

    it('returns content after the last therapist response', () => {
      const content = `Had a rough day.

> **Therapist:** What happened?

My boss yelled at me.`;

      expect(getNewContent(content)).toBe('My boss yelled at me.');
    });

    it('returns empty string when therapist response is last thing', () => {
      const content = `Had a rough day.

> **Therapist:** What happened?`;

      expect(getNewContent(content)).toBe('');
    });

    it('handles multiple therapist responses and returns content after the last one', () => {
      const content = `Had a rough day.

> **Therapist:** What happened?

My boss yelled at me.

> **Therapist:** How did that make you feel?

Angry and embarrassed.`;

      expect(getNewContent(content)).toBe('Angry and embarrassed.');
    });

    it('handles multi-line user content after therapist response', () => {
      const content = `Starting point.

> **Therapist:** Tell me more.

First line of response.
Second line of response.
Third line.`;

      const result = getNewContent(content);
      expect(result).toContain('First line of response.');
      expect(result).toContain('Second line of response.');
      expect(result).toContain('Third line.');
    });

    it('ignores content that looks like blockquotes but is not therapist', () => {
      const content = `I read this quote:

> Some random quote

Then I felt better.`;

      // Since there's no therapist response, should return all content
      expect(getNewContent(content)).toBe(content.trim());
    });
  });

  describe('isTherapistResponse', () => {
    it('returns true for therapist response', () => {
      expect(isTherapistResponse('> **Therapist:** How are you?')).toBe(true);
    });

    it('returns true for therapist response with leading whitespace', () => {
      expect(isTherapistResponse('  > **Therapist:** How are you?')).toBe(true);
    });

    it('returns false for regular content', () => {
      expect(isTherapistResponse('I had a good day')).toBe(false);
    });

    it('returns false for other blockquotes', () => {
      expect(isTherapistResponse('> Some quote')).toBe(false);
    });
  });

  describe('formatResponse', () => {
    it('formats response as blockquote with proper spacing', () => {
      const response = 'How does that make you feel?';
      const formatted = formatResponse(response);

      expect(formatted).toBe('\n\n> **Therapist:** How does that make you feel?\n\n');
    });

    it('preserves response content exactly', () => {
      const response = 'Multi-word response with punctuation!';
      const formatted = formatResponse(response);

      expect(formatted).toContain(response);
    });
  });

  describe('THERAPIST_PREFIX', () => {
    it('has the expected value', () => {
      expect(THERAPIST_PREFIX).toBe('> **Therapist:**');
    });
  });
});
