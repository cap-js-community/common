"use strict";

const { perform } = require("./common");

module.exports = async ({ name = "default" }) => {
  const counts = {};

  async function increment(key) {
    return await perform(
      `${name}/${key}`,
      async (client, key) => {
        return await client.incr(key);
      },
      (key) => {
        counts[key] ??= 0;
        counts[key]++;
        return counts[key];
      },
    );
  }

  async function decrement(key) {
    return await perform(
      `${name}/${key}`,
      async (client, key) => {
        return await client.decr(key);
      },
      (key) => {
        counts[key] ??= 0;
        counts[key]--;
        return counts[key];
      },
    );
  }

  async function reset(key) {
    return await perform(
      `${name}/${key}`,
      async (client, key) => {
        const status = await client.set(key, 0);
        if (status === "OK") {
          return 0;
        }
      },
      (key) => {
        counts[key] = 0;
        return counts[key];
      },
    );
  }

  return {
    increment: async function (key) {
      return await increment(key);
    },
    decrement: async function (key) {
      return await decrement(key);
    },
    reset: async function (key) {
      return await reset(key);
    },
  };
};
