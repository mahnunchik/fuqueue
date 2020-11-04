'use strict';

class TimeoutError extends Error {
  constructor(milliseconds) {
    super(`Promise timed out after ${milliseconds} milliseconds`);
    this.name = 'TimeoutError';
  }
}

function timeout(promise, milliseconds) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(milliseconds));
    }, milliseconds);

    promise
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timer);
      });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

module.exports = {
  timeout,
  delay,
};
