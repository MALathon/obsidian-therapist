/**
 * Content parsing utilities for the therapist plugin
 */

export const THERAPIST_PREFIX = '> **Therapist:**'; // Default, but can be customized
export const JOURNAL_HEADERS = ['# Journal', '## Journal', '### Journal'];

/**
 * Get the therapist prefix with custom name
 */
export function getTherapistPrefix(name: string = 'Therapist'): string {
  return `> **${name}:**`;
}

/**
 * Extract new content since the last therapist response
 * Returns the text the user has written after the most recent therapist response
 */
export function getNewContent(fullContent: string): string {
  // Find the last therapist response
  const lastResponseIndex = fullContent.lastIndexOf(THERAPIST_PREFIX);

  if (lastResponseIndex === -1) {
    // No previous response, return all content
    return fullContent.trim();
  }

  // Get everything after the therapist prefix
  const afterPrefix = fullContent.substring(lastResponseIndex);

  // Split into lines and find where the blockquote ends
  const lines = afterPrefix.split('\n');
  let userContentStart = -1;
  let inBlockquote = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (inBlockquote) {
      // Still in blockquote - look for non-blockquote, non-empty line
      if (trimmed === '' || trimmed.startsWith('>')) {
        continue; // Still part of blockquote or blank line
      } else {
        // Found user content
        userContentStart = i;
        break;
      }
    }
  }

  if (userContentStart === -1) {
    return ''; // No user content after therapist response
  }

  // Join remaining lines as user content
  return lines.slice(userContentStart).join('\n').trim();
}

/**
 * Check if content is a therapist response (to avoid responding to own responses)
 */
export function isTherapistResponse(content: string): boolean {
  return content.trim().startsWith(THERAPIST_PREFIX);
}

/**
 * Format a therapist response as a blockquote
 * Handles multi-line responses by blockquoting each line
 */
export function formatResponse(response: string, therapistName: string = 'Therapist'): string {
  const prefix = getTherapistPrefix(therapistName);
  const lines = response.split('\n');
  const blockquoted = lines.map((line, i) => {
    if (i === 0) return `${prefix} ${line}`;
    if (line.trim() === '') return '>'; // Empty blockquote line preserves paragraph breaks
    return `> ${line}`;
  }).join('\n');
  return `\n\n${blockquoted}\n\n`;
}

/**
 * Extract content under a Journal header
 * Returns null if no journal section exists
 */
export function getJournalContent(fullContent: string): string | null {
  // Find any journal header
  let journalStart = -1;
  let headerLevel = 0;

  for (const header of JOURNAL_HEADERS) {
    const idx = fullContent.indexOf(header);
    if (idx !== -1 && (journalStart === -1 || idx < journalStart)) {
      journalStart = idx;
      headerLevel = header.split(' ')[0].length; // Count #'s
    }
  }

  if (journalStart === -1) {
    return null; // No journal section
  }

  // Find the end - next header of same or higher level, or end of file
  const afterHeader = fullContent.substring(journalStart);
  const lines = afterHeader.split('\n');
  let endIndex = lines.length;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Check if this is a header of same or higher level
    const headerMatch = line.match(/^(#{1,6})\s/);
    if (headerMatch && headerMatch[1].length <= headerLevel) {
      endIndex = i;
      break;
    }
  }

  return lines.slice(1, endIndex).join('\n').trim();
}

/**
 * Check if content contains engagement cues suggesting user wants a response
 */
export function hasEngagementCue(content: string): boolean {
  const lowerContent = content.toLowerCase();

  // Direct questions
  if (content.includes('?')) return true;

  // Engagement phrases
  const cues = [
    'you know',
    'right?',
    'what do you think',
    'any thoughts',
    'help me',
    'i need',
    'should i',
    'could i',
    'what should',
    'what would',
    'advice',
    'suggest',
    'opinion',
    'perspective',
    'thoughts?',
    'ideas?',
  ];

  return cues.some(cue => lowerContent.includes(cue));
}
