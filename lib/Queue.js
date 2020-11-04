'use strict';

const { v4: uuid } = require('uuid');
const Db = require('./Db');
const Worker = require('./Worker');
const { AddError } = require('./errors');

class Queue {
  constructor(options = {}) {
    this.db = new Db(options);
  }

  async add(queue, data, options = {}) {
    if (!queue) {
      throw new TypeError('Queue name is required');
    }
    const {
      id = uuid(),
      priority = 0,
      timeout = 5000,
      maxAttempts = 1,
    } = options;

    try {
      const collection = await this.db.collection();
      const res = await collection.findOneAndUpdate({
        _id: id,
        status: 'enqueued',
      }, {
        $set: {
          queue,
          data,
          priority,
          timeout,
          attempts: 0,
          maxAttempts,
        },
        $setOnInsert: {
          enqueuedAt: new Date(),
        },
      }, {
        returnOriginal: false,
        upsert: true,
      });
      return res.value;
    } catch (err) {
      if (err.code === 11000) {
        throw new AddError(id);
      }
      throw err;
    }
  }

  worker(queue, func, options) {
    return new Worker(this.db, queue, func, options);
  }
}

module.exports = Queue;
