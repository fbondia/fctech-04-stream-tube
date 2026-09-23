import { DomainException } from '../common/exceptions/domain.exception';

export class UnsupportedRangeException extends DomainException {
  constructor() {
    super('UNSUPPORTED_RANGE', 400, 'Unsupported byte range');
  }
}

export class RangeNotSatisfiableException extends DomainException {
  constructor() {
    super('RANGE_NOT_SATISFIABLE', 416, 'Byte range not satisfiable');
  }
}

export interface ByteRange {
  start: number;
  end: number;
}

export function parseVideoRange(header: string, size: number): ByteRange {
  if (!Number.isSafeInteger(size) || size < 1)
    throw new RangeNotSatisfiableException();
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new UnsupportedRangeException();
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if (
    (first !== null && !Number.isSafeInteger(first)) ||
    (last !== null && !Number.isSafeInteger(last))
  )
    throw new UnsupportedRangeException();
  if (first === null) {
    if (last === 0) throw new RangeNotSatisfiableException();
    return { start: Math.max(0, size - last!), end: size - 1 };
  }
  if (first >= size || (last !== null && last < first))
    throw new RangeNotSatisfiableException();
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}
