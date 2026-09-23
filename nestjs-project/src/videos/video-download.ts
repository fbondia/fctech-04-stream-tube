export function attachmentDisposition(filename: string): string {
  // The stored filename is basename-only, but sanitize again at the HTTP boundary.
  const safe =
    [...filename]
      .map((character) =>
        character.charCodeAt(0) < 32 ||
        character.charCodeAt(0) === 127 ||
        character === '/' ||
        character === '\\'
          ? '_'
          : character,
      )
      .join('')
      .slice(0, 255) || 'video';
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(safe).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
