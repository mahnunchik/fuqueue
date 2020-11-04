'use strict';

const { MongoClient } = require('mongodb');
const Queue = require('./Queue');
const { AddError } = require('./errors');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/futest';

describe('queue', () => {
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

  it('should throw error without queue name', async () => {
    queue = new Queue({ uri: MONGO_URI });
    await expect(queue.add()).rejects.toThrow('Queue name is required');
  });

  it('should create a job with default parameters', async () => {
    queue = new Queue({ uri: MONGO_URI });
    const job = await queue.add('test', { foo: 'bar' });
    expect(job).toMatchObject({
      data: { foo: 'bar' },
      maxAttempts: 1,
      priority: 0,
      queue: 'test',
      status: 'enqueued',
      timeout: 5000,
    });
  });

  it('should create a job with custom parameters', async () => {
    queue = new Queue({ uri: MONGO_URI });
    const job = await queue.add('test', { foo: 'baz' }, {
      id: 'custom',
      priority: 100,
      timeout: 10000,
      maxAttempts: 42,
    });
    expect(job).toMatchObject({
      _id: 'custom',
      data: { foo: 'baz' },
      maxAttempts: 42,
      priority: 100,
      queue: 'test',
      status: 'enqueued',
      timeout: 10000,
    });
  });

  it('should update a job', async () => {
    queue = new Queue({ uri: MONGO_URI });
    const original = await queue.add('test', { foo: 'original' }, {
      id: 'update',
      priority: 1,
      timeout: 1,
      maxAttempts: 1,
    });
    const updated = await queue.add('test', { foo: 'updated' }, {
      id: 'update',
      priority: 100,
      timeout: 1000,
      maxAttempts: 42,
    });
    expect(updated).toMatchObject({
      data: { foo: 'updated' },
      maxAttempts: 42,
      priority: 100,
      queue: 'test',
      status: 'enqueued',
      timeout: 1000,
      // timestamp must not be updated
      enqueuedAt: original.enqueuedAt,
    });
  });

  it('should not update a dequeued job', async () => {
    queue = new Queue({ uri: MONGO_URI });
    await queue.add('test', { foo: 'original' }, {
      id: 'not update',
      priority: 1,
      timeout: 1,
      maxAttempts: 1,
    });
    await collection.updateOne({
      _id: 'not update',
    }, {
      $set: { status: 'dequeued' },
    });
    await expect(queue.add('test', { foo: 'updated' }, {
      id: 'not update',
      priority: 100,
      timeout: 1000,
      maxAttempts: 42,
    })).rejects.toThrow(AddError);
  });
});
