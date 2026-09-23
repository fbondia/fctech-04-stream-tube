import { DomainException } from '../common/exceptions/domain.exception';

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class InvalidVideoStateException extends DomainException {
  constructor() {
    super(
      'INVALID_VIDEO_STATE',
      409,
      'Video state does not allow this operation',
    );
  }
}

export class InvalidVideoInputException extends DomainException {
  constructor() {
    super('VALIDATION_ERROR', 400, 'Invalid video metadata');
  }
}
