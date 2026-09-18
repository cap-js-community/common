"use strict";

const KIND = "local";

module.exports = ({ window } = {}) => {
  let resetTime = null;
  const counts = {};

  async function setResetTime() {
    if (!resetTime) {
      resetTime = new Date();
      resetTime.setMilliseconds(resetTime.getMilliseconds() + window);
    }
    return resetTime;
  }

  async function clearResetTime() {
    resetTime = null;
  }

  async function increment(tenant) {
    counts[tenant] ??= 0;
    return ++counts[tenant];
  }

  async function reset(tenant) {
    counts[tenant] = 0;
    return counts[tenant];
  }

  return {
    kind: KIND,
    expires: false,
    setResetTime,
    clearResetTime,
    increment,
    reset,
  };
};

module.exports.KIND = KIND;
