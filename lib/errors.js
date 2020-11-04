/* eslint-disable max-classes-per-file */

'use strict';

class LockError extends Error {
  constructor(lock) {
    super(`lock missing '${lock}'`);
  }
}

class AddError extends Error {
  constructor(id) {
    super(`Impossible to update dequeued task id '${id}'`);
  }
}

module.exports = {
  LockError,
  AddError,
};
