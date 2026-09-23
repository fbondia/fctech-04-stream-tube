import {
  parseVideoRange,
  RangeNotSatisfiableException,
  UnsupportedRangeException,
} from './video-range';
import { attachmentDisposition } from './video-download';

describe('video byte ranges', () => {
  it('parses initial, middle, final and suffix ranges', () => {
    expect(parseVideoRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseVideoRange('bytes=20-29', 100)).toEqual({ start: 20, end: 29 });
    expect(parseVideoRange('bytes=99-', 100)).toEqual({ start: 99, end: 99 });
    expect(parseVideoRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseVideoRange('bytes=95-999', 100)).toEqual({
      start: 95,
      end: 99,
    });
    expect(parseVideoRange('bytes=-999', 100)).toEqual({ start: 0, end: 99 });
  });

  it('separates unsupported syntax from unsatisfiable ranges', () => {
    for (const header of [
      'items=0-1',
      'bytes=0-1,2-3',
      'bytes=a-b',
      'bytes=-',
      'bytes=9007199254740992-',
    ])
      expect(() => parseVideoRange(header, 100)).toThrow(
        UnsupportedRangeException,
      );
    for (const header of ['bytes=100-', 'bytes=8-7', 'bytes=-0'])
      expect(() => parseVideoRange(header, 100)).toThrow(
        RangeNotSatisfiableException,
      );
  });
});

describe('video download filename', () => {
  it('quotes an ASCII fallback and encodes the UTF-8 filename', () => {
    expect(attachmentDisposition('ação "final".mp4')).toBe(
      'attachment; filename="a__o _final_.mp4"; filename*=UTF-8\'\'a%C3%A7%C3%A3o%20%22final%22.mp4',
    );
    expect(attachmentDisposition("o'brien.mp4")).toContain(
      "filename*=UTF-8''o%27brien.mp4",
    );
  });
});
