"use strict";

const KIND = "local";

module.exports = ({ window } = {}) => {
  let resetTime = null;
  const counts = {};

  async function setup() {
    // Nothing to clear
  }

  async function setResetTime() {
    resetTime = new Date();
    resetTime.setMilliseconds(resetTime.getMilliseconds() + window);
    return resetTime;
  }

  async function getResetTime() {
    return resetTime ?? await setResetTime();
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
    setup,
    setResetTime,
    getResetTime,
    increment,
    reset,
  };
};

module.exports.KIND = KIND;
