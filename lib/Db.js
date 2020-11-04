'use strict';

const { MongoClient } = require('mongodb');

class Db {
  constructor(options = {}) {
    this.options = {
      collection: 'queue',
      ...options,
    };
    this.client = new MongoClient(this.options.uri, ({
      useUnifiedTopology: true,
      ...this.options.mongo,
    }));
  }

  collection() {
    if (!this.coll) {
      this.coll = this.client.connect()
        .then(() => this.init())
        .then(() => this.client.db().collection(this.options.collection));
    }
    return this.coll;
  }

  init() {
    // TODO indexes
    return this.client;
  }

  close() {
    return this.client.close();
  }
}

module.exports = Db;
