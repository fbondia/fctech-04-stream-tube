import { InvalidVideoStateException } from './videos.errors';
import { VideoStatus } from './entities/video.entity';

const ALLOWED: Record<VideoStatus, readonly VideoStatus[]> = {
  draft: ['processing', 'error'],
  processing: ['ready', 'error'],
  ready: [],
  error: ['processing'],
};

export function assertVideoTransition(
  from: VideoStatus,
  to: VideoStatus,
): void {
  if (!ALLOWED[from].includes(to)) throw new InvalidVideoStateException();
}
