"use strict";

const { perform } = require("./common");

module.exports = async ({ name = "default" }) => {
  let resetTime;

  async function set(date) {
    return await perform(
      name,
      async (client, key) => {
        const status = await client.set(key, date.toISOString());
        if (status === "OK") {
          return date;
        }
      },
      () => {
        resetTime = date;
      },
    );
  }

  async function get() {
    return await perform(
      name,
      async (client, key) => {
        const value = await client.get(key);
        return value ? new Date(value) : null;
      },
      () => {
        return resetTime;
      },
    );
  }

  return {
    set: async function (date) {
      return await set(date);
    },
    get: async function () {
      return await get();
    },
  };
};
