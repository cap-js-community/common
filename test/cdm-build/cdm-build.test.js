"use strict";

const { CDMBuilder } = require("../../src/cdm-build");

process.env.PORT = 0; // Random

describe("CDM Builder", () => {
  it("Build", async () => {
    const cdmBuilder = new CDMBuilder({ skipWrite: true });
    const cdm = await cdmBuilder.build();
    expect(cdm).toMatchSnapshot();
  });
});
