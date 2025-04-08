"use strict";

async function wait(milliseconds) {
  if (milliseconds <= 0) {
    return;
  }
  await new Promise(function (resolve) {
    setTimeout(resolve, milliseconds);
  });
}

module.exports = {
  wait,
};
