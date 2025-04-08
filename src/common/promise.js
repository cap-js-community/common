"use strict";

const VError = require("verror");

async function allDone(iterable) {
  const results = await Promise.allSettled(iterable);
  const rejects = results.filter((entry) => {
    return entry.status === "rejected";
  });
  if (rejects.length === 1) {
    return Promise.reject(rejects[0].reason);
  } else if (rejects.length > 1) {
    return Promise.reject(new VError.MultiError(rejects.map((reject) => reject.reason)));
  }
  return results.map((entry) => {
    return entry.value;
  });
}

Promise.allDone = allDone;

module.exports = {
  allDone,
};
