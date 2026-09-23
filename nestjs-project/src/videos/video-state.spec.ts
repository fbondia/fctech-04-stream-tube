import { assertVideoTransition } from './video-state';

describe('video state machine', () => {
  it('accepts only the planned edges', () => {
    for (const [from, to] of [
      ['draft', 'processing'],
      ['draft', 'error'],
      ['processing', 'ready'],
      ['processing', 'error'],
      ['error', 'processing'],
    ] as const)
      expect(() => assertVideoTransition(from, to)).not.toThrow();
    for (const [from, to] of [
      ['draft', 'ready'],
      ['ready', 'draft'],
      ['ready', 'processing'],
      ['error', 'ready'],
      ['processing', 'draft'],
    ] as const)
      expect(() => assertVideoTransition(from, to)).toThrow();
  });
});
