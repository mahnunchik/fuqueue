'use strict';

const { MongoClient } = require('mongodb');
const Queue = require('./Queue');
const { delay } = require('./utils');
const { LockError } = require('./errors');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/futest';

const noop = () => {};

describe('worker', () => {
  let client;
  let db;
  let collection;
  let queue;

  beforeAll(async () => {
    client = await MongoClient.connect(MONGO_URI, {
      useUnifiedTopology: true,
    });
    db = client.db();
    collection = db.collection('queue');
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await collection.drop().catch(() => {});
  });

  afterEach(async () => {
    await queue.db.close();
  });

  it('should create a worker for all queues', async () => {
    queue = new Queue({ uri: MONGO_URI });
    const worker = queue.worker('*', noop, { paused: true });
    expect(worker.query).toStrictEqual({});
  });

  it('should create a worker for single queue', async () => {
    queue = new Queue({ uri: MONGO_URI });
    const worker = queue.worker('name', noop, { paused: true });
    expect(worker.query).toStrictEqual({ queue: 'name' });
  });

  it('should create a worker for list of queues', async () => {
    queue = new Queue({ uri: MONGO_URI });
    const worker = queue.worker(['foo', 'bar'], noop, { paused: true });
    expect(worker.query).toStrictEqual({ queue: { $in: ['foo', 'bar'] } });
  });

  it('should create a worker with custom query', async () => {
    queue = new Queue({ uri: MONGO_URI });
    const worker = queue.worker({ foo: 'bar' }, noop, { paused: true });
    expect(worker.query).toStrictEqual({ foo: 'bar' });
  });

  it('should throw incorrct queue error', async () => {
    queue = new Queue({ uri: MONGO_URI });
    expect(() => {
      queue.worker(12345, noop, { paused: true });
    }).toThrow('Incorrect queue argument');
  });

  it('should process jobs in order of adding', async () => {
    queue = new Queue({ uri: MONGO_URI });
    await queue.add('adding order', 'first');
    await queue.add('adding order', 'second');
    await queue.add('adding order', 'third');

    const order = [];
    const worker = queue.worker('adding order', (job) => {
      order.push(job);
    });
    await worker.start();
    await new Promise((resolve) => {
      worker.once('drained', () => {
        resolve();
      });
    });
    await worker.stop();
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('should process jobs in order of priority', async () => {
    queue = new Queue({ uri: MONGO_URI });
    await queue.add('priority order', 'second', { priority: 0 });
    await queue.add('priority order', 'third', { priority: -1 });
    await queue.add('priority order', 'first', { priority: 1 });

    const order = [];
    const worker = queue.worker('priority order', (job) => {
      order.push(job);
    });
    await worker.start();
    await new Promise((resolve) => {
      worker.once('drained', () => {
        resolve();
      });
    });
    await worker.stop();
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('should make 3 attempts', async () => {
    queue = new Queue({ uri: MONGO_URI });
    await queue.add('attempts', 'attempts', { maxAttempts: 3 });
    let attempts = 0;
    const worker = queue.worker('attempts', () => {
      attempts++;
      throw new Error('failed job');
    });
    await worker.start();
    await new Promise((resolve) => {
      worker.once('drained', () => {
        resolve();
      });
    });
    await worker.stop();
    expect(attempts).toEqual(3);
  });

  it('should emit stalled', async () => {
    queue = new Queue({ uri: MONGO_URI });
    await queue.add('stalled', 'stalled', { id: 'stalled' });
    await collection.updateOne({
      _id: 'stalled',
    }, {
      $set: {
        status: 'dequeued',
        stalledAt: new Date(0),
      },
    });
    const worker = queue.worker('stalled', noop);
    await worker.start();
    await expect(new Promise((resolve) => {
      worker.on('stalled', resolve);
    })).resolves.toEqual(1);
    await worker.stop();
  });

  it('should emit drained once', async () => {
    queue = new Queue({ uri: MONGO_URI });
    const worker = queue.worker('drained', noop, {
      pull: 1,
    });
    let drained = 0;
    worker.on('drained', () => {
      drained++;
    });
    await worker.start();
    await delay(1000);
    await worker.stop();
    expect(drained).toEqual(1);
  });

  it('should emit stopped once', async () => {
    queue = new Queue({ uri: MONGO_URI });
    await queue.add('stopped', 'stopped', { id: 'stopped' });
    const worker = queue.worker('stopped', () => delay(1000));
    let stopped = 0;
    worker.on('stopped', () => {
      stopped++;
    });
    await worker.start();
    await worker.stop();
    expect(stopped).toEqual(1);
  });

  it('should throw missing lock', async () => {
    queue = new Queue({ uri: MONGO_URI });
    await queue.add('lock', 'lock', { id: 'lock' });
    const worker = queue.worker('lock', async () => {
      await collection.updateOne({
        _id: 'lock',
      }, {
        $set: { lock: 'fake' },
      });
    });
    await Promise.all([
      worker.start(),
      expect(new Promise((resolve, reject) => {
        worker.on('error', reject);
      })).rejects.toThrow(LockError),
    ]);
    await worker.stop();
  });
});
