/**
 * Content parsing utilities for the therapist plugin
 */

export const THERAPIST_PREFIX = '> **Therapist:**';

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
export function formatResponse(response: string): string {
  const lines = response.split('\n');
  const blockquoted = lines.map((line, i) => {
    if (i === 0) return `${THERAPIST_PREFIX} ${line}`;
    if (line.trim() === '') return '>'; // Empty blockquote line preserves paragraph breaks
    return `> ${line}`;
  }).join('\n');
  return `\n\n${blockquoted}\n\n`;
}
