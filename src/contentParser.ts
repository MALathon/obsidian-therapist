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

  // Find the end of the last response (next non-blockquote line after blank line)
  const afterResponse = fullContent.substring(lastResponseIndex);

  // Look for double newline followed by non-blockquote content
  const match = afterResponse.match(/\n\n(?!>)(.+)/s);

  if (!match) {
    // Response is at the end or only blockquotes after, nothing new
    return '';
  }

  return match[1].trim();
}

/**
 * Check if content is a therapist response (to avoid responding to own responses)
 */
export function isTherapistResponse(content: string): boolean {
  return content.trim().startsWith(THERAPIST_PREFIX);
}

/**
 * Format a therapist response as a blockquote
 */
export function formatResponse(response: string): string {
  return `\n\n${THERAPIST_PREFIX} ${response}\n\n`;
}
