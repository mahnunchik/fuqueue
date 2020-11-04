'use strict';

const os = require('os');
const EventEmitter = require('events');
const { v4: uuid } = require('uuid');
const { timeout, delay } = require('./utils');
const { LockError } = require('./errors');

class Worker extends EventEmitter {
  constructor(db, queue, func, options = {}) {
    super();

    if (queue === '*') {
      this.query = {};
    } else if (typeof queue === 'string') {
      this.query = {
        queue,
      };
    } else if (Array.isArray(queue)) {
      this.query = {
        queue: { $in: queue },
      };
    } else if (queue !== null && typeof queue === 'object') {
      this.query = queue;
    } else {
      throw new TypeError(`Incorrect queue argument: ${queue}`);
    }

    this.db = db;
    this.concurrency = 0;
    this.maxConcurrency = options.maxConcurrency || 1;
    this.paused = true;
    this.drained = false;
    this.name = options.name
      || `${typeof queue === 'object' ? JSON.stringify(queue) : queue}@${os.hostname()}`;
    this.pull = options.pull || 5000;

    this.func = (job) => Promise.resolve(job).then(func);
    this.process = () => setImmediate(() => this._process());
  }

  delay() {
    if (!this._delay) {
      this._delay = delay(this.pull);
      this._delay
        .then(this.process)
        .finally(() => {
          this._delay = null;
        });
    }
  }

  dequeue() {
    const lock = uuid();
    // https://docs.mongodb.com/master/reference/method/db.collection.updateOne/#update-one-method-agg-pipeline
    return this.collection
      .findOneAndUpdate({
        ...this.query,
        status: 'enqueued',
      }, [{
        $set: {
          status: 'dequeued',
          dequeuedAt: new Date(),
          stalledAt: {
            $add: [new Date(), '$timeout'],
          },
          attempts: {
            $add: [1, '$attempts'],
          },
          worker: this.name,
          lock,
        },
      }],
      {
        returnOriginal: false,
        sort: {
          priority: -1,
          enqueuedAt: 1,
        },
      })
      .then((res) => res.value)
      .catch((err) => this.emit('error', err));
  }

  handler(job) {
    return timeout(this.func(job.data), job.timeout)
      .then((result) => { // eslint-disable-line arrow-body-style
        return this.collection.findOneAndUpdate({
          lock: job.lock,
        }, {
          $set: {
            status: 'completed',
            result,
            completedAt: new Date(),
          },
          $unset: {
            lock: true,
            stalledAt: true,
          },
        }, {
          returnOriginal: false,
        });
      }, (error) => { // eslint-disable-line arrow-body-style
        return this.collection.findOneAndUpdate({
          lock: job.lock,
        }, {
          $set: {
            status: (job.attempts < job.maxAttempts) ? 'enqueued' : 'failed',
            error: {
              message: error.message,
              stack: error.stack,
            },
            failedAt: new Date(),
          },
          $unset: {
            lock: true,
            stalledAt: true,
          },
        }, {
          returnOriginal: false,
        });
      })
      .then((updated) => {
        if (!updated.value) {
          throw new LockError(job.lock);
        }
      })
      .catch((err) => this.emit('error', err));
  }

  stalled() {
    return this.collection.updateMany({
      ...this.query,
      status: 'dequeued',
      stalledAt: {
        $lt: new Date(),
      },
    }, {
      $set: {
        status: 'enqueued',
      },
      $unset: {
        lock: true,
        stalledAt: true,
      },
      $inc: {
        attempts: -1,
      },
    }).then((res) => {
      if (res.modifiedCount) {
        this.emit('stalled', res.modifiedCount);
      }
    }).catch((err) => this.emit('error', err));
  }

  async _process() {
    if (this.paused === true) {
      return;
    }
    // enqueue stalled jobs
    await this.stalled();

    if (this.paused === true || this.concurrency >= this.maxConcurrency) {
      return;
    }

    // capture
    this.concurrency++;
    const job = await this.dequeue();

    if (job) {
      if (this.concurrency < this.maxConcurrency) {
        // run in parallel
        this.process();
      }
      await this.handler(job);
    }

    // release
    this.concurrency--;

    if (!job !== this.drained) {
      if (this.drained === false) {
        this.emit('drained');
      }
      this.drained = !job;
    }

    if (this.paused && this.concurrency === 0) {
      // all jobs done
      this.emit('stopped');
      return;
    }
    if (!job && this.concurrency === 0) {
      // wait for new jobs
      this.delay();
      return;
    }
    // next tick
    this.process();
  }

  start() {
    return this.db.collection()
      .then((collection) => {
        this.collection = collection;
        if (this.paused) {
          this.paused = false;
          this.emit('started');
          this.process();
        }
      });
  }

  stop() {
    this.paused = true;
    if (this.concurrency === 0) {
      this.emit('stopped');
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.once('stopped', resolve);
      // resolve if started while stopping
      this.once('started', resolve);
    });
  }
}

module.exports = Worker;
