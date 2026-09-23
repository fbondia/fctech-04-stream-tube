import { VideoDispatcher, videoJobId } from './video-dispatcher';

describe('VideoDispatcher', () => {
  it('publishes a stable v1 job and marks the leased intent', async () => {
    const sql: string[] = [];
    const db = {
      query: (statement: string): Promise<unknown[]> => {
        sql.push(statement);
        return Promise.resolve([]);
      },
      transaction: async (
        run: (manager: {
          query: (statement: string) => Promise<unknown[]>;
        }) => Promise<unknown>,
      ) =>
        await run({
          query: (statement: string): Promise<unknown[]> => {
            sql.push(statement);
            return Promise.resolve(
              statement.startsWith('SELECT')
                ? [{ id: 'outbox-1', video_id: 'video-1', generation: 2 }]
                : [],
            );
          },
        }),
    };
    const queue = { add: jest.fn().mockResolvedValue({}) };
    expect(
      await new VideoDispatcher(db as never, queue as never).dispatch(1),
    ).toBe(1);
    expect(queue.add).toHaveBeenCalledWith(
      'process-video-v1',
      {
        schemaVersion: 1,
        videoId: 'video-1',
        generation: 2,
        outboxId: 'outbox-1',
      },
      expect.objectContaining({ jobId: videoJobId('video-1', 2), attempts: 3 }),
    );
    expect(sql.at(-1)).toContain("status = 'published'");
  });

  it('releases the lease if Redis rejects publication', async () => {
    const sql: string[] = [];
    const db = {
      query: (statement: string): Promise<unknown[]> => {
        sql.push(statement);
        return Promise.resolve([]);
      },
      transaction: async (
        run: (manager: {
          query: (statement: string) => Promise<unknown[]>;
        }) => Promise<unknown>,
      ) =>
        await run({
          query: (statement: string): Promise<unknown[]> => {
            sql.push(statement);
            return Promise.resolve(
              statement.startsWith('SELECT')
                ? [{ id: 'o', video_id: 'v', generation: 1 }]
                : [],
            );
          },
        }),
    };
    const queue = {
      add: (): Promise<void> => Promise.reject(new Error('Redis unavailable')),
    };
    await expect(
      new VideoDispatcher(db as never, queue as never).dispatch(1),
    ).rejects.toThrow('Redis unavailable');
    expect(sql.at(-1)).toContain('lease_token = NULL');
  });

  it('requeues published intent when its retained job is missing', async () => {
    const sql: string[] = [];
    const db = {
      query: (statement: string): Promise<unknown[]> => {
        sql.push(statement);
        return Promise.resolve(
          statement.startsWith('SELECT')
            ? [{ id: 'o', video_id: 'v', generation: 1, status: 'draft' }]
            : [],
        );
      },
    };
    const queue = { getJob: (): Promise<null> => Promise.resolve(null) };
    await new VideoDispatcher(db as never, queue as never).reconcile();
    expect(sql.at(-1)).toContain("status = 'pending'");
  });
});
